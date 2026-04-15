# Binzbonz

**A self-hosted agent orchestration platform that ships software from a brief.**

Give it a name and a paragraph describing what you want built. A Master agent breaks the brief into MVP → Sprint → Epic → Feature → Task, assigns developer agents, and the agents actually build it — in real git branches, with real commits, on your machine.

No cloud. No per-token billing. No SaaS. Runs on the Claude Max subscription you already have, plus any OpenAI-compatible model for the cheap coordination work.

![Binzbonz multi-project dashboard](demo/multi-project-dashboard.png)

---

## In pictures

### Multi-project dashboard
One flat pool of agents, any project can borrow any dev.

![Multi-project dashboard](demo/multi-project-dashboard.png)

### Hierarchical tickets
MVP → Sprint → Epic → Feature → Task, generated from your brief.

![Ticket hierarchy](demo/ticket-hierarchy.png)

### Resumable Claude sessions
Open a terminal to any agent and jump into its live conversation.

![Resumable Claude session](demo/resumable-claude-session.png)

### Per-project session isolation
The same `dev-2` has separate context per project. No bleed.

![Per-project sessions](demo/per-project-sessions.png)

### Heartbeat coordinators
An OpenAI-compatible agent (DeepSeek here) scans projects on a schedule and nudges stuck work. Costs cents a day.

![Heartbeat coordinator](demo/heartbeat-coordinator.png)


---

## Why Binzbonz (and how it differs from Paperclip)

If you've used **Paperclip**, you know the shape: a centralized control plane for agent fleets with governance, hiring approvals, org charts, delegation chains, and company-grade workflow. That's the right tool when you're running agents across a team and every action needs to be auditable and gated by policy.

---

# The three things that make Binzbonz cheap and fast

Most orchestration platforms burn tokens on the same three problems: they rebuild the agent's context from scratch every run, they stuff the whole project into the prompt, and they lose the conversation across restarts. Binzbonz solves each one. Here's exactly how.

## 1. How Binzbonz keeps the session alive

![Resumable Claude session](demo/resumable-claude-session.png)

Every agent has a **persistent Claude session** that survives across wake events, runner crashes, and even laptop reboots. The agent's conversation history — the skill file it already read, the code it already looked at, the decisions it already made — is never thrown away.

### One session per (agent, project)

Sessions live in the `[agent_project_session](apps/api/src/agent-project-sessions/)` table, keyed by `(agent_id, project_id)`:

```
agent_project_session
  id                uuid
  agent_id          uuid  →  actor
  project_id        uuid  →  project
  session_id        text  ← Claude's own session UUID
  last_token_count  int
  last_active_at    timestamptz
  message_history   jsonb ← for OpenAI-compatible agents
```

The runner never reads from a global `actor.session_id`. The lookup is always *"give me the session for (this agent, this project)."* That's why the same `dev-2` can work on two projects with completely separate conversations — each project has its own row.

![Per-project sessions for one agent](demo/per-project-sessions.png)

In the screenshot above, `dev-2` has two active sessions: one for `sway` (13 tokens) and one for `NamNguyenHomePage` (47 tokens). Neither knows the other exists.

### How the session is resumed

On every wake event, the runner:

1. Looks up `(agent_id, project_id)` → gets `session_id`
2. Spawns `claude --resume <session_id> --dangerously-skip-permissions -p <delta-prompt>`
3. Claude picks up exactly where it left off — full conversation history intact

See `[agent-runner/src/claude-spawner.ts](agent-runner/src/claude-spawner.ts)` and `[agent-runner/src/index.ts](agent-runner/src/index.ts)`.

### Early session-id capture (crash recovery)

Claude emits the `session_id` in its very first `system/init` event, ~100ms after spawn. Most systems wait for the process to exit before writing anything to the DB. Binzbonz writes the session_id **as soon as it's emitted**:

```typescript
// agent-runner/src/index.ts
const onSessionId = (sid: string) => {
  log('runner', `Captured session_id ${sid.slice(0, 8)} for ${actor.name}`);
  upsertAgentProjectSession(actor.id, event.project_id, { session_id: sid });
};
```

If the runner crashes mid-spawn, the power cuts out, or you `kill -9` the process, the session is still recoverable. The web terminal can open `claude --resume <sid>` from exactly that point.

### Resume failure handling

- **Session 404** (Claude says "no conversation with that id") → clear `session_id`, fall through to a new session, write the new id back. The row is preserved so history of `last_active_at` is kept.
- **Quota / rate limit** → stop immediately. Do **not** invalidate the session, do **not** retry. Post a `block` comment on the task so a human can pick it up later. The next wake will try again under the same session_id.
- **Retry ladder for transient errors** → exponential backoff (2s, 4s, 8s), max 3 attempts, only on the *resume* path. First hit on a new session never retries.

### The web terminal uses the same session

When you click **>_ Terminal** on an agent in a project context, the WebSocket gateway resumes the same `session_id` via a real PTY (node-pty) and hands you the interactive Claude prompt with the full conversation already loaded.

**You and the agent are looking at the same session.** Whatever the agent was doing, you can continue. Whatever you do in the terminal, the agent will see on its next wake.

---

## 2. How Binzbonz injects project data into context

![Ticket hierarchy](demo/ticket-hierarchy.png)

Every wake event gives the agent a freshly-built **wake message** — a structured summary of everything it needs to know to act, and nothing it doesn't.

### What gets built on every wake

From `[agent-runner/src/prompt-builder.ts](agent-runner/src/prompt-builder.ts)` `buildContext()`:

```
## Project: <name>
Brief: <one paragraph>
Project status: analysing | active | paused | completed

## Project configuration (from binzbonz.md — overrides your skill defaults)
- Integration branch: `main`
- Peer review required: NO
- Auto-merge to `main` after done: YES

## Task: <title> (task_id: <uuid>)
Status: in_progress
Description: <...>
Branch name to use: `task/a3f2b1c0`   ← pre-resolved, no guessing

## Recent comments:
- [update] dev-1 (4:12pm): started on the db schema
- [question] brian (4:15pm): should we use text or uuid for ids?
- [update] dev-1 (4:18pm): going with uuid
- ...last 10 comments, max...

## Actor roster (KEY: only @mention agents, NEVER humans)
Agents you may @mention to wake them:
  - @dev-1 (role: developer, status: working)
  - @dev-2 (role: developer, status: idle)
  - @master (role: master, status: idle)
Humans (NEVER @mention these — they read the UI directly):
  - brian

## Memory files changed since your last activity:
- memory/architecture.md
- memory/api-conventions.md

You were @mentioned in a comment. Read the comments above and respond
or take action accordingly via the API.
```

Notice what's **not** there:

- No full re-dump of `memory/` — only the files that *changed* since the agent last ran
- No comment history beyond the last 10
- No schema, no API docs, no tool list — those live in the skill file, which is only sent once (see next section)
- No `@mention me every time` fluff — the trigger-specific instruction at the bottom is one paragraph

### Per-project `binzbonz.md` overrides

Each project has a `[binzbonz.md](apps/api/src/projects/workspace-setup.service.ts)` file in its workspace with a fenced JSON block the runner re-reads on every wake:

```json
{
  "default_branch": "main",
  "task_branch_template": "task/{task_id_short}",
  "auto_merge": true,
  "need_review_by_other_dev": false
}
```

Want a `dev` integration branch on one project and `main` on another? Set it. Want peer review on one project only? Set it. The runner resolves the exact branch name the agent should check out and writes it into the wake message as `**Branch name to use: \`task/a3f2b1c0`** — pre-computed, no placeholder-interpretation for the agent to get wrong.

### Memory delta — not memory dump

Shared project context lives in `memory/*.md` — git-tracked markdown files every agent reads natively. The API tracks each file's `last_updated_at`. On wake, the runner queries:

```
GET /projects/:projectId/memory-files/changed?since=<session.last_active_at>
```

Only the *paths* of changed files are injected into the wake message. The agent re-reads only what changed, not the whole memory dir. A busy project with 40 memory files still sends 2 lines of delta on the average wake.

### Role-aware trigger instructions

The last line of the wake message changes based on `event.triggered_by`:


| Trigger      | What the agent is told                                                    |
| ------------ | ------------------------------------------------------------------------- |
| `assignment` | "You have been assigned to this task. Read the description and start."    |
| `mention`    | "You were @mentioned in a comment. Read the comments and respond."        |
| `heartbeat`  | Full scan checklist — only given to coordinator agents on scheduled ticks |
| `chat`       | "A human posted a chat message. Respond briefly via your tools."          |


The developer agent never sees heartbeat instructions. The coordinator never sees the "pick up a task branch" block. Every wake only contains what's relevant to *this* agent for *this* reason.

---

## 3. How Binzbonz saves tokens

Agent platforms that naively rebuild context on every call burn tokens on the same data over and over. Binzbonz avoids that in four ways.

### Technique 1: Skill file loaded exactly once

Every role has a skill file in `[skills/](skills/)` — `developer.md`, `master.md`, `openapidev.md`, `openapicoor.md`. These are big (100+ lines of API docs, workflow rules, git rules, comment style, error handling).

The prompt builder distinguishes two cases in `[agent-runner/src/prompt-builder.ts](agent-runner/src/prompt-builder.ts)`:

```typescript
// NEW SESSION: no session_id → load skill file + identity + context
if (!sessionState.session_id) {
  parts.push(skill);        // full skill file — ~3-4k tokens
  parts.push('---');
  parts.push(identity);
  parts.push(context);
  return { prompt, isNewSession: true };
}

// RESUMED SESSION: skill is ALREADY in the agent's conversation memory
// → only send the fresh context (a few hundred tokens)
return { prompt: context, isNewSession: false };
```


|              | First wake      | Second wake   | Tenth wake    |
| ------------ | --------------- | ------------- | ------------- |
| Skill file   | ✅ ~3,500 tokens | ❌ 0 tokens    | ❌ 0 tokens    |
| Identity     | ✅ ~60 tokens    | ❌ 0 tokens    | ❌ 0 tokens    |
| Wake message | ✅ ~500 tokens   | ✅ ~500 tokens | ✅ ~500 tokens |


After the first wake, every subsequent wake is ~500 tokens of input. The skill file is already in Claude's conversation memory — sending it again would be redundant *and* would invalidate the prompt cache on Claude's side.

### Technique 2: Memory delta, not memory dump

See [Section 2](#2-how-binzbonz-injects-project-data-into-context) above. Memory files are never re-injected in full once an agent has seen them; only changed file *paths* are listed. The agent re-reads files itself via its own `Read` tool, naturally cached on Claude's side.

### Technique 3: Comment window

Recent comments are sliced to the last 10:

```typescript
// prompt-builder.ts
const recent = comments.slice(-10);
for (const c of recent) {
  parts.push(`- [${c.comment_type}] ${c.body}`);
}
```

A task with 200 comments still injects 10 lines. Older discussion can be re-read on demand via the `getTaskComments(task_id)` tool — the agent decides when to pay for more history.

### Technique 4: Automatic compaction watermarks

The spawner reads `input_tokens` from Claude's stream-json output after every run and writes it back to `agent_project_session.last_token_count`. Two watermarks kick in:

```typescript
// prompt-builder.ts
if (sessionState.last_token_count > 960_000) {
  return { prompt: '/compact', isNewSession: false };   // force compact NOW
}

if (sessionState.last_token_count > 900_000) {
  parts.push('[CONTEXT WARNING: You are at 900k+ tokens. Run /compact
              after processing this message.]');
}
```

- **At 900k input tokens** → the next wake message is prefixed with a gentle warning telling the agent to compact after finishing the current turn.
- **At 960k input tokens** → the wake message is *only* `/compact`. Nothing else runs until the context shrinks.

The `session_id` is preserved across compaction — Claude compacts in place. No re-onboarding, no re-reading the skill file, no losing the conversation. The counter resets naturally on the next measurement.

### What this adds up to

For a typical 20-task project, a single developer agent:

- Loads its skill file **once** at first wake
- Receives ~500-token wake messages for every subsequent event
- Reads memory files on demand, cached
- Compacts automatically before hitting any Claude limit
- Never cold-starts its context

Compared to a "rebuild on every run" platform sending 4,000-token prompts every wake, you save **~7× on input tokens over the lifetime of a project** — and the savings grow with the number of wake events per session.

---

## Features at a glance

- **Hierarchical tickets** — MVP → Sprint → Epic → Feature → Task, auto-generated from your brief
- **Flat agent pool** — no org chart, no delegation chain, any project borrows any dev
- **Resumable Claude sessions** — never cold-start (see above)
- **Per-project session isolation** — no context bleed between projects
- **OpenAI-compatible coordinators** — heartbeat scans via DeepSeek / Kimi / Groq / OpenRouter
- **Git worktree per task** — real branches, real isolation, real merges
- **Shared project memory** in markdown, git-tracked, symlinked into every worktree
- **Realtime UI** via Postgres `LISTEN`/`NOTIFY` → SSE, no polling
- **Embedded Postgres** — zero external services
- `**binzbonz.md` per project** — override integration branch, peer review, auto-merge without touching code
- **Web terminal** attaches to any agent's live Claude CLI session
- **Mention parser** — `@dev-3` in any comment wakes that agent within 2 seconds
- **Status gating** — during `analysing`/`paused`, only the Master agent runs

---

## Quick Start

```bash
# Requires Node.js >= 20 and pnpm >= 10
pnpm install
pnpm dev
```

First boot:

1. Downloads and starts an embedded Postgres on port `54329`
2. Creates all tables via TypeORM `synchronize: true`
3. Seeds a default agent pool: one `master`, four developers (`dev-1`..`dev-4`), one human (`brian`)
4. Opens at **[http://localhost:3000](http://localhost:3000)**


| Service      | URL                                            | Role                                                     |
| ------------ | ---------------------------------------------- | -------------------------------------------------------- |
| Web UI       | [http://localhost:3000](http://localhost:3000) | Next.js frontend                                         |
| API          | [http://localhost:3001](http://localhost:3001) | NestJS backend + embedded Postgres                       |
| Agent Runner | —                                              | Worker that polls wake events and spawns Claude sessions |


> **One-time setup:** make sure you're logged into Claude Code (`claude auth status`). Binzbonz spawns real `claude` CLI processes and inherits your auth.

---

## Your First Project

From the web UI: **New Project** → name it, paste a brief, pick (or browse to) a repo path.

```
Name:  Todo MVP
Brief: Build a todo app with user auth, list sharing, and a
       Next.js frontend. Use Postgres for persistence.
Path:  /Users/me/Work/todo-mvp
```

What happens next:

1. Project starts in `analysing` status — only the Master agent can act
2. Master breaks the brief into MVP → Sprint → Epic → Feature → Task
3. Master assigns developers and transitions the project to `active`
4. Each developer wakes, creates a git worktree, implements the task, runs tests, merges
5. You watch it happen in realtime on the Board / Tree view, and can jump into any agent's terminal whenever

---

## Architecture

```
┌────────────────┐       ┌─────────────────┐       ┌──────────────────┐
│  Next.js Web   │◄─SSE──│  NestJS API     │──────►│ Embedded         │
│  (localhost    │──HTTP─►│  + pg_notify   │◄──────│ Postgres         │
│   :3000)       │       │  (:3001)        │       │ (:54329)         │
└────────────────┘       └────────┬────────┘       └──────────────────┘
                                  │ polls /wake-events
                                  ▼
                         ┌─────────────────┐       ┌──────────────────┐
                         │  Agent Runner   │──────►│  claude CLI      │
                         │  (TypeScript    │       │  --resume <sid>  │
                         │   worker)       │──────►│  OpenAI SDK      │
                         └─────────────────┘       │  (DeepSeek etc.) │
                                                   └──────────────────┘
```

Three tables hold it together:

- `**actor**` — humans and agents, unified
- `**wake_event**` — a queue of "wake agent X on project Y because of reason Z"
- `**comment**` — every agent-to-agent and human-to-agent message
- `**agent_project_session**` — one Claude session per (agent, project) pair

A comment like `@dev-3 please handle the password reset flow` parses out the mention, inserts a `wake_event`, the runner picks it up within 2 seconds, resumes Claude with the freshly-built wake message, and the output streams back as more comments.

---

## Provider Support

### Claude CLI (`developer`, `master`)

Real `claude` CLI process, full tool access (Read/Edit/Bash/Git), resumable sessions. This is what you want for the agents that actually write code.

### OpenAI-compatible (`openapidev`, `openapicoor`)

Any OpenAI-compatible HTTP endpoint. No shell, no filesystem by default — messages in / messages out with function calling wired to the Binzbonz API. Perfect for:

- **Cheap coordinators** that scan projects on a heartbeat and nudge stuck work (`openapicoor`)
- **Lightweight dev assistants** with sandboxed file tools (`openapidev`)

Pre-wired providers: **DeepSeek, Kimi (Moonshot), OpenAI, Groq, OpenRouter, Mistral, xAI**. Adding a new one is a 5-line change to `[apps/web/app/agents/page.tsx](apps/web/app/agents/page.tsx)`.

---

## Repo Layout

```
/
├── apps/
│   ├── api/                   NestJS backend + embedded Postgres (port 3001)
│   │   └── src/
│   │       ├── actors/        humans + agents, unified table
│   │       ├── projects/      project entity + workspace setup
│   │       ├── hierarchy/     MVP / Sprint / Epic / Feature
│   │       ├── tasks/         tasks + subtasks + status transitions
│   │       ├── comments/      comments + @mention parser → wake events
│   │       ├── wake-events/   wake event queue
│   │       ├── events/        pg_notify triggers + SSE gateway
│   │       ├── terminal/      WebSocket terminal for interactive claude sessions
│   │       ├── memory/        shared memory files
│   │       └── seed/          default agent pool
│   └── web/                   Next.js frontend (port 3000)
├── agent-runner/              TypeScript worker — polls, spawns, streams
│   └── src/
│       ├── claude-spawner.ts  spawns `claude` CLI with --resume + retry
│       ├── openai-spawner.ts  spawns OpenAI-compatible chat with function calling
│       ├── openai-tools.ts    JSON-schema tool defs backed by the Binzbonz API
│       └── prompt-builder.ts  skill file + context + delta
├── skills/
│   ├── developer.md           skill loaded by Claude developer agents
│   ├── master.md              skill loaded by the Master coordinator
│   ├── openapidev.md          skill for OpenAI-compatible developer agents
│   ├── openapicoor.md         skill for OpenAI-compatible coordinators
│   └── binbondev.md           skill for working ON this codebase
└── demo/                      the screenshots in this README
```

---

## Using an External Postgres

```bash
DATABASE_URL=postgres://user:pass@host:5432/binzbonz pnpm dev
```

## Running Services Individually

```bash
pnpm --filter @binzbonz/api dev           # API only (starts embedded Postgres)
pnpm --filter @binzbonz/web dev           # Next.js frontend only
pnpm --filter @binzbonz/agent-runner dev  # Agent runner only
```

---

## Roadmap

Designed, not yet built:

- `**[docs/roadmap/multi-account-sessions.md](docs/roadmap/multi-account-sessions.md)**` — one session per (agent, Claude account). Handles Claude Max account rotation cleanly instead of invalidating everything on switch.
- `**[docs/roadmap/file-tree-editor.md](docs/roadmap/file-tree-editor.md)**` — Monaco editor + file tree on the project page so humans can edit code alongside the agents.
- `**[docs/roadmap/openai-compatible-agent.md](docs/roadmap/openai-compatible-agent.md)**` — the full spec for the OpenAI-compatible provider.

---

## Contributing

This is an open-source side project — PRs, bug reports, and new provider integrations are all welcome.

Good first issues:

- Add a new OpenAI-compatible provider (5 lines in `[apps/web/app/agents/page.tsx](apps/web/app/agents/page.tsx)`)
- Add a new comment type + UI badge
- Add a new skill file for a specialised role (security reviewer, docs writer, test writer)

See `[skills/binbondev.md](skills/binbondev.md)` for architecture notes and conventions, and `[docs/main_doc.md](docs/main_doc.md)` for the original BRD and schema.

---

## Status

Early and opinionated. It runs, it builds projects, the screenshots above are real. Expect rough edges. Open an issue and tell me about them.

## License

MIT