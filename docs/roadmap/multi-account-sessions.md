# Multi-Account Session Support

## Problem

Users often have 2–3 (sometimes up to 20) Claude Max accounts and rotate between them when one hits its quota or for organizational reasons. The current system only stores **one** `session_id` per agent, which is bound to whichever Claude account was authenticated when that session was created.

When the user switches accounts:
- All existing sessions become invalid (`No conversation found with session ID`)
- The runner falls back to creating new sessions
- Each agent loses its conversation history
- The agent has no idea what happened while the other account was in use

We use **one global Claude auth at a time** — never multiple accounts simultaneously — so this is a sequential switching problem, not a concurrent multi-account problem.

## Goals

1. Store **one session_id per agent per Claude account** so switching accounts doesn't lose context
2. Auto-detect the current Claude account on runner startup (and periodically)
3. When an agent wakes up under a previously-used account, **resume the matching session**
4. When resuming a stale session, **inject only what changed** since that session was last active — not the entire history
5. When an agent wakes up under a brand-new account, **create a new session** and inject the full skill file + current state

---

## Database Schema

### New table: `agent_session`

```sql
agent_session
  id                uuid PK
  agent_id          uuid FK → actor (cascade delete)
  account_email     text
  session_id        text nullable
  last_token_count  int default 0
  last_active_at    timestamptz nullable
  created_at        timestamptz
  UNIQUE(agent_id, account_email)
```

One row per `(agent_id, account_email)` combination. The actor table can keep its existing `session_id` / `last_token_count` / `last_active_at` columns as a "current" mirror, OR we drop them and always look up via `agent_session`. **Decision pending.**

---

## Current Account Detection

### On runner startup

```bash
claude auth status
```

Returns JSON like:
```json
{
  "loggedIn": true,
  "authMethod": "claude.ai",
  "email": "hongphong2120@gmail.com",
  "subscriptionType": "max"
}
```

Extract `email` → store as global `currentAccountEmail` in the runner process.

### Periodic re-check

Re-check every 5 minutes (or on demand) to detect mid-run account switches. If `currentAccountEmail` changes:
- Log the switch loudly
- Don't kill in-flight processes (let them finish)
- Future spawns use the new account's sessions

---

## Spawn Flow (per wake event)

1. **Read `currentAccountEmail`** from runner state
2. **Look up `agent_session`** where `agent_id + account_email = currentAccountEmail`
3. Three cases:

   **Case A — Row exists with `session_id`:**
   - Resume the session
   - Compute delta: query everything that changed since `agent_session.last_active_at` that's relevant to this agent
   - Build prompt: short context + delta summary + new task instructions
   - No skill file (agent already has it from prior runs in this session)

   **Case B — Row exists but `session_id` is null** (e.g. previous run failed before saving):
   - Spawn new session for this account
   - Build prompt: full skill file + identity + full task context
   - On success, save the new `session_id` to the row

   **Case C — No row exists (first time on this account):**
   - Insert a new `agent_session` row with `session_id = null` 
   - Spawn new session for this account
   - Build prompt: full skill file + identity + full task context
   - On success, save the `session_id` and `last_active_at`

4. **After spawn completes:**
   - Update `agent_session.session_id`, `last_token_count`, `last_active_at`
   - The `actor` table's `session_id` is updated as a mirror of the current account's session (for backward-compat with the existing UI)

---

## Delta Computation

### What changed while a session slept?

Given `since = agent_session.last_active_at` and `agent_id`, fetch:

1. **Comments on tasks assigned to this agent** where `comment.created_at > since`
   - Includes comments from other agents/humans
   - Includes the agent's own past comments? **No** — they already remember those
2. **Task status/assignment changes** where `task.updated_at > since` AND task is currently assigned to this agent OR was newly assigned to this agent
3. **New tasks assigned to this agent** where the assignment happened after `since`
4. **Memory file changes** where `memory_file.last_updated_at > since`
5. **New tickets created** in the project where `created_at > since` (only at task level — MVP/Sprint/Epic/Feature changes are noise unless we're Master)

### Delta prompt format

```
You were last active at <ISO timestamp>. Here's what happened since then:

## New comments on your tasks:
- [task: Setup DB] dev-2 (10:15): "Merged your PR, looks good"
- [task: Setup DB] master (10:20): "Moving to done"

## Task changes:
- "Setup DB" → done (was: review_request)
- "Build login" → newly assigned to you

## Memory updates:
- memory/architecture.md
- memory/conventions.md

## New tasks in the project:
- "Add password reset flow" (assigned to dev-3)
- "Refactor auth middleware" (unassigned)

Continue from where you left off. Your current task is: <task title>
```

### New API endpoint

```
GET /agents/:agentId/delta?since=<ISO timestamp>&projectId=<uuid>

Response:
{
  "comments": [...],
  "task_changes": [...],
  "new_assignments": [...],
  "memory_changes": [...],
  "new_tickets": [...]
}
```

---

## Edge Cases

1. **Account switches mid-spawn** — let the in-flight process finish, save under the OLD account email (which it actually used). Next spawn uses the new account.
2. **`claude auth status` fails** — runner can't determine the account. Block spawning until we can. Log loudly.
3. **Multiple accounts sharing the same email** — not possible (Claude uses email as identity)
4. **Account A has stale session_id (404)** — same as today: fall back to new session, but only update Account A's row, don't touch others
5. **User logged out of Claude** — `claude auth status` returns `loggedIn: false`. Block spawning, surface error in UI.
6. **Agent has 5 different account sessions** — fine, all stored. Only the matching one is used per spawn.
7. **`last_active_at` is null (brand new row)** — no delta needed, this is a fresh session for this account.

---

## Migration

For existing data: when this feature ships, the `actor.session_id` field belongs to whatever account was active when those sessions were created. We don't know which account that was. Options:
- **Drop existing sessions** — agents get fresh sessions on first spawn under any account
- **Migrate as "unknown"** — insert an `agent_session` row with `account_email = 'unknown'`, never matched
- **Detect on first spawn** — try to use the current `actor.session_id`, if it works under the current account, migrate it to that row; if it 404s, drop it

Recommended: **detect on first spawn**. Minimal disruption.

---

## UI Changes

### Agent detail page
- Show a list of all sessions for this agent, grouped by account email
- For each: session_id (truncated), last_active_at, token count
- Highlight the row matching the current Claude account
- Show "this is a new account, no session yet" if no row matches

### Sidebar
- Add a small indicator showing the current Claude account (e.g. "📧 hongphong2120@...")
- Tooltip with full email and subscription tier
- Refreshes when the runner detects an account change (via SSE event?)

### Settings / Status page
- Show `claude auth status` output
- Button: "Refresh account detection"
- List of all accounts ever used + how many sessions exist per account

---

## Implementation Order

1. Add `agent_session` entity + table (TypeORM auto-migrates with `synchronize: true`)
2. Add `getCurrentClaudeAccount()` helper in agent-runner that calls `claude auth status`
3. Cache the email on runner startup, re-check every 5 min
4. Add `findOrCreateAgentSession(agentId, accountEmail)` in API
5. Update runner spawn flow to use `agent_session` lookup
6. Add `GET /agents/:id/delta` endpoint
7. Update prompt builder to inject delta when resuming a stale session
8. Update UI to show current account + per-account session list
9. Migrate existing `actor.session_id` data (detect-on-first-spawn approach)
10. Drop `actor.session_id` etc. (or keep as mirror) — decide later

---

## Open Questions

- **Should `actor.session_id` be removed or kept as a mirror?** Mirror is simpler for the UI but adds dual-write complexity.
- **Should the runner block when `claude auth status` fails?** Yes — without an account, sessions can't be tracked correctly.
- **How often to re-check the account?** Every 5 min seems reasonable. Check on every poll is wasteful.
- **What about API key auth (`ANTHROPIC_API_KEY`)?** If set, that bypasses claude.ai login. Treat the key prefix as the "account email" (e.g. `apikey:sk-ant-...`)?
- **Should the delta have a max size?** A 6-hour gap could produce hundreds of comments. Cap at 50 most recent? Summarize?
