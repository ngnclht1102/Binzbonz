# Per-Project Session Storage

## Problem

`actor.session_id` is a single column on the agent row. When the same agent works on multiple projects, the runner resumes the **same** Claude session for all of them — so Project A's conversation history bleeds into Project B's context, and the agent answers questions for one project with assumptions from the other.

This is most painful for shared global agents like `ctbaceo` and `dev-1` who get assigned across many projects. They start mixing decisions, file paths, and code conventions between unrelated codebases.

We need **one session per (agent, project)** so each project has its own clean conversational context.

This is orthogonal to the multi-account problem in [multi-account-sessions.md](./multi-account-sessions.md) — that one is "same agent, same project, different Claude account". This one is "same agent, same account, different project". The two compose into a `(agent, project, account)` triple — see "Composition with multi-account" below.

---

## Goals

1. Store **one session_id per agent per project** so context never mixes across projects
2. On every spawn, resume the session that matches `(agent_id, project_id)` — never the actor's global session
3. When an agent is wakened on a project it has never worked on before, **create a new session** and load the full skill file + project context
4. Cascade-delete sessions when their project or agent goes away
5. The web terminal opens the project-scoped session, not the global one

---

## Database Schema

### New table: `agent_project_session`

```sql
agent_project_session
  id                uuid PK
  agent_id          uuid FK → actor (cascade delete)
  project_id        uuid FK → project (cascade delete)
  session_id        text nullable
  last_token_count  int default 0
  last_active_at    timestamptz nullable
  created_at        timestamptz
  updated_at        timestamptz
  UNIQUE(agent_id, project_id)
```

One row per `(agent_id, project_id)` pair. Cascade delete from both sides:
- Delete a project → all its sessions go away
- Delete an agent → all its sessions go away

The actor's existing `session_id` / `last_token_count` / `last_active_at` columns are **dropped in the same PR**. The UI reads everything from `agent_project_session` going forward — there's no global "most recently used" mirror, since the global terminal will use the project-picker dropdown (see UI Changes).

---

## Spawn Flow (per wake event)

The wake event already has `agent_id` and `project_id`, so the lookup is trivial.

1. **Look up `agent_project_session`** by `(agent_id, project_id)`
2. Three cases:

   **Case A — Row exists with `session_id`:**
   - Resume the session (`claude --resume <session_id>`)
   - Build prompt: short context (current task + recent comments) — **no skill file**, agent already has it from prior runs in this session
   - On success, update `last_active_at`, `last_token_count`, mirror to `actor.session_id`

   **Case B — Row exists but `session_id` is NULL** (e.g. previous run failed or session was invalidated):
   - Spawn a new session
   - Build prompt: full skill file + identity + task context
   - On success, save the new `session_id` to the row

   **Case C — No row exists** (first time on this project):
   - Insert a new `agent_project_session` row with `session_id = NULL`
   - Spawn a new session
   - Build prompt: full skill file + identity + task context
   - On success, save the `session_id` and `last_active_at`

3. **On `session_gone` (404 from claude resume):**
   - Set `session_id = NULL` on the existing row
   - Fall through to Case B / new session
   - Don't drop the row — preserve `last_active_at` history

4. **On quota error:** stop, comment, leave the row untouched.

---

## Web Terminal Flow

[apps/api/src/terminal/terminal.gateway.ts](../../apps/api/src/terminal/terminal.gateway.ts) currently resumes `actor.session_id` (the global mirror). After this change, it resumes `agent_project_session.session_id` for the `(agentId, projectId)` the terminal was opened with. The frontend already passes `projectId` in the `init` message, so no client change is needed.

If no row exists for that pair → no resume, just open a fresh interactive session in the project workspace. Same behaviour as today when `actor.session_id` is null.

---

## Prompt Builder Changes

[agent-runner/src/prompt-builder.ts](../../agent-runner/src/prompt-builder.ts) currently:
- For new sessions: loads skill file + builds full context
- For resume sessions: builds short context (no skill file)

Behaviour stays identical, but the **decision input** changes from "does the actor have a session_id?" to "does the `agent_project_session` row have a session_id?".

The runner needs to fetch the row before calling the prompt builder, then pass `existingSessionId: string | null` into it.

---

## API Changes

### New endpoints

```
GET    /agents/:agentId/project-sessions              List all per-project sessions for an agent
GET    /projects/:projectId/agent-sessions            List all agent sessions for a project
DELETE /agent-project-sessions/:id                    Manually drop a session (force re-init next spawn)
```

The runner doesn't strictly need a public endpoint — it can read the table directly via TypeORM. The HTTP endpoints are for the UI.

### Modified endpoints

`GET /agents/:agentId` — extend the response to include the count of per-project sessions and (optionally) the list. Or leave as is and let the UI hit the new endpoint. Recommend the latter to avoid bloating the existing payload.

---

## Edge Cases

1. **Same agent assigned to two projects rapidly** — sequential queue (one-at-a-time, already enforced) means each spawn picks the right session. No race.
2. **Project deleted while agent has an active wake event** — cascade delete drops the row before the runner reads it. The runner should handle "row not found" by creating a fresh session in case the project was recreated, but more likely this is a race and the wake event is also gone. Skip with a log.
3. **Agent deleted** — cascade delete drops all rows for that agent.
4. **Session 404 (`No conversation found`)** — set `session_id = NULL`, retry as new session under same row. Don't churn the row.
5. **Session created with `-p` mode is unusable in interactive terminal** — known issue from [skills/binbondev.md](../../skills/binbondev.md) Gotcha #6. The web terminal falls through to a fresh interactive session, but does NOT overwrite the runner's `session_id` on the row, since the runner still uses it successfully in `-p` mode.
6. **Two wake events for the same `(agent, project)` arrive close together** — the dedup window in [tasks.service.ts](../../apps/api/src/tasks/tasks.service.ts) already collapses these. Not a session-storage problem.
7. **Migration leaves old `actor.session_id` populated** — see Migration section.

---

## Migration

Drop the columns entirely: `actor.session_id`, `actor.last_token_count`, `actor.last_active_at`. With TypeORM `synchronize: true`, removing the columns from the entity is enough — the next API boot will drop them from the schema.

Every agent loses its existing conversation history. The first wake on each `(agent, project)` after deploy creates a fresh row + session naturally. This is acceptable: most agents only have a handful of turns of context, and the alternative (migrating one global session to "most recent project") would seed contexts wrongly.

---

## UI Changes

### Agent detail page ([apps/web/app/agents/[agentId]/page.tsx](../../apps/web/app/agents/[agentId]/page.tsx))

Add a **"Project Sessions"** section listing every project this agent can work on, with the per-project session status:

```
┌──────────────────────────────────────────────────┐
│ Project Sessions                                 │
├──────────────────────────────────────────────────┤
│ Binzbonz       a3f2b1...   12k tokens   2h ago  │
│ Brian's CV     6328b8...   3k tokens    1d ago  │
│ Side project   (no session yet)            ⚪    │   ← greyed out
└──────────────────────────────────────────────────┘
```

- Rows with a session: full color, click → opens the project's terminal already wired to that session
- Rows with no session: **greyed out**, click → opens a fresh terminal in that project workspace (which will create the session on first send)

### Web terminal — opening from a project

Already has `(agentId, projectId)`. Just resolve the session for that pair and resume it. No UI change.

### Web terminal — opening from the global agents page

Currently the global agent detail page has a single "Open Terminal" button with no project context. After this change:

- Replace the button with a **project picker dropdown**: lists every project the agent has a session for, plus every other project (greyed out)
- Picking a project → opens the terminal scoped to that `(agent, project)` pair
- Default selection: the project of the most-recently-active session (sorted by `last_active_at`)

### Project detail → Agents tab

Show each agent's per-project session status next to their name (e.g. dot indicator: filled = has session, hollow = will create on first wake).

### Project files / tree pages

No change.

---

## Composition with Multi-Account

When [multi-account-sessions.md](./multi-account-sessions.md) ships, the UNIQUE key on this table extends from `(agent_id, project_id)` to `(agent_id, project_id, account_email)`. Migration adds the column with a default of `'__legacy__'`, then the multi-account runner populates real values going forward.

The two roadmaps are independent in scope but both touch the same table. If both ship, the table layout becomes:

```sql
agent_project_session
  id                uuid PK
  agent_id          uuid FK → actor (cascade delete)
  project_id        uuid FK → project (cascade delete)
  account_email     text default '__legacy__'   -- added by multi-account roadmap
  session_id        text nullable
  last_token_count  int default 0
  last_active_at    timestamptz nullable
  created_at        timestamptz
  updated_at        timestamptz
  UNIQUE(agent_id, project_id, account_email)
```

If we ship per-project first (this doc), we can add `account_email` later without dropping data — existing rows just get the `'__legacy__'` value and continue to work for the single-account case.

---

## Implementation Order

1. **Add `AgentProjectSession` entity + module** (TypeORM auto-migrates with `synchronize: true`)
2. **Add `findOrCreate(agentId, projectId)` + `markActive(...)`** service methods
3. **Update agent runner spawn flow** to look up by `(agent_id, project_id)` instead of reading `actor.session_id`
4. **Update prompt builder** to take `existingSessionId` as a parameter rather than reading it from the actor
5. **Update web terminal gateway** to resolve session via `agent_project_session` for the `(agentId, projectId)` pair
6. **Add `GET /agents/:id/project-sessions` endpoint** for the UI
7. **Update agent detail page** to show per-project session list (greyed out for no-session projects) + project picker for the global "Open Terminal" entry
8. **Drop `actor.session_id`, `actor.last_token_count`, `actor.last_active_at`** columns in the same PR. Migration step: a single `UPDATE actor SET session_id = NULL, ...` is not needed because the columns themselves are gone — TypeORM `synchronize: true` will drop them on first boot
9. **Verify**: assign the same agent to two different projects, confirm each spawn resumes the right session and contexts don't bleed

---

## What's NOT in scope

- **Cross-project context transfer** — there's no "copy session from Project A to Project B". If the user wants that, they manually @mention the agent on the new project with a hand-written summary.
- **Cross-account context transfer** — see [multi-account-sessions.md](./multi-account-sessions.md), separate roadmap.
- **Per-task sessions** — too granular. A project-scoped session can handle many tasks within the same project; the agent will switch context between tasks within its own conversation just fine.
- **Session pruning / archival** — we don't delete old sessions until their project or agent is deleted. If sessions grow stale and waste tokens, address in a future "session cleanup" pass.

---

## Decisions Locked In

- **Drop `actor.session_id` etc. in the same PR** — no mirror, no follow-up. The UI reads only from `agent_project_session`.
- **No-session projects render greyed out** in the agent detail page so the user can see which projects an agent is *available for* vs *has worked on*.
- **No heartbeats for Claude agents.** A future DeepSeek-via-API provider will own heartbeat-style wake-ups, so this roadmap doesn't need a "global / no-project" session row.
- **Global "Open Terminal" → project picker dropdown.** The global agent page must always pick a project before opening a terminal. No silent fallback to a global session.
