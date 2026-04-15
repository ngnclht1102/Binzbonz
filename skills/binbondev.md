## Tech Stack

| Layer | Choice |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| Backend | NestJS 11 (TypeScript, Node16 modules) |
| Database | Embedded Postgres via `embedded-postgres@^18.1.0-beta.16` |
| ORM | TypeORM 0.3 with `synchronize: true` (no migration files) |
| Realtime | Postgres LISTEN/NOTIFY via SSE |
| Frontend | Next.js 14 (app router) + Tailwind CSS + Zustand |
| Agent runner | Node.js TypeScript worker, polls every 2s, processes 1 event at a time |
| Web terminal | xterm.js + WebSocket + `@homebridge/node-pty-prebuilt-multiarch` |
| File logger | Custom inline batched logger writing to `logs/{service}-YYYY-MM-DD.log` |

**Important version notes:**
- Node 24.3 — `node-pty@1.1.0` does NOT work, use `@homebridge/node-pty-prebuilt-multiarch`
- `embedded-postgres` requires the platform-specific binary package (e.g. `@embedded-postgres/darwin-arm64`)
- `nest start --watch` does NOT play well with `incremental: true` in tsconfig — leave it `false`
- All build scripts that need native compilation must be approved in root `package.json` under `pnpm.onlyBuiltDependencies`

---

## What's Built (and How It Works)

### Backend (apps/api)

- **Embedded Postgres** boots inside the NestJS process. Lifecycle: check PG_VERSION → check postmaster.pid AND port reachability → start cluster → ensure `binzbonz` database exists → connect TypeORM. Defaults to port 54329, falls back to next free port. Connection string is `postgres://binzbonz:binzbonz@127.0.0.1:54329/binzbonz`.
- **Schema** (auto-synced from entities): actor, project, mvp, sprint, epic, feature, task, comment, project_comment, memory_file, wake_event. 17 foreign keys including self-referencing `task.parent_task_id`.
- **HTTP API** for full CRUD on actors, projects, hierarchy, tasks, comments, wake events, memory files. Status transitions enforced on projects (analysing→active→completed) and tasks (backlog→assigned→in_progress→done|cancelled, etc.). Invalid transitions → 400.
- **Mention parser** scans every comment body for `@name` patterns, looks up matching agents, and creates wake events. Has dedup: skips creating an event if the same agent already has one pending/processing/done within the last 60s for the same task.
- **Wake event creation on assignment**: when a task's `assigned_agent_id` changes, a wake event with `triggered_by: 'assignment'` is created automatically (with the same dedup window).
- **pg_notify triggers** on `comment`, `task`, `wake_event` tables. The Events module LISTENs on a separate `pg` client and pushes to an SSE endpoint at `GET /events/stream`.
- **Workspace setup**: when a project is created without a `repo_path`, `WorkspaceSetupService.setup()` creates a directory at `~/.binzbonz/projects/<slug>-<id>/`, copies `CLAUDE.md` + `skills/`, creates `memory/` and `worktrees/`, runs `git init -b main` and an initial commit. If a custom path is passed, it uses that instead.
- **Filesystem endpoints** at `/filesystem/browse`, `/filesystem/home`, `/filesystem/mkdir` — used by the directory picker in the New Project form. NOT yet scoped per-project; no path containment yet (used only in trusted contexts).
- **Terminal WebSocket gateway** at `ws://localhost:3001/terminal`. Spawns interactive `claude --resume <session_id> --dangerously-skip-permissions` in a real PTY (via `@homebridge/node-pty-prebuilt-multiarch`). Resolves the `claude` binary path with `which claude` to avoid PATH issues. Streams stdin/stdout/resize over JSON messages.
- **DualLogger** (`dual-logger.ts`) implements `LoggerService` from NestJS and writes every log to BOTH console and `logs/api-YYYY-MM-DD.log` via the inline batched `file-logger.service.ts`. Batched writes flush every 1s or when the buffer hits 100 entries — no race conditions on file writes.
- **LoggingInterceptor** logs every HTTP request/response with method, URL, body keys, status, duration.

### Agent runner (agent-runner)

- **Watchdog**: `watchdog.sh` runs `tsx src/index.ts` and restarts on crash. Backoff: 2s, 4s, 8s... capped at 30s. Resets the counter after 60s of stable running. Gives up after 10 crashes.
- **Startup cleanup**: on every start, queries the API for all `processing` wake events and resets them to `pending`. Same for actors stuck in `working` → `idle`. This cleans up after crashes.
- **Polling loop**: queries `GET /wake-events?status=pending` every 2 seconds. **Processes exactly 1 event at a time** (sequential). The `processing` flag prevents concurrent runs even if multiple events queue up.
- **Per-event flow**:
  1. Mark event `processing`
  2. Load actor + project
  3. **Gate**: if project status is `analysing` or `paused` AND agent is not `master` → mark `skipped`
  4. Set actor status `working`
  5. Build prompt (see below)
  6. Spawn Claude (resume if session exists, else new)
  7. Post output as comment(s) on the task
  8. Update actor: `session_id`, `last_token_count`, `last_active_at`, status `idle`
  9. Mark event `done` (or `failed` on error)
- **Prompt builder** (`prompt-builder.ts`): for NEW sessions, loads the full skill file (`developer.md` or `master.md`) + identity + project context + task context + recent comments + memory changes since last active. For RESUMED sessions, only sends the new context (skill is already in the agent's session memory).
- **Claude spawner** (`claude-spawner.ts`):
  - Always uses `--dangerously-skip-permissions --verbose --output-format stream-json -p <prompt>`
  - Always uses `stdin: 'ignore'` to avoid the "no stdin data received" warning
  - Sets `cwd` to `project.repo_path`
  - **Retry policy**: resume with backoff (2s, 4s, 8s) up to 3 attempts. If session-not-found → skip retries, fall back to new session. If quota error → STOP, no retry, no new session, post a `🚫 Agent stopped` comment as a `block` type.
  - **Error classification** scans `errors[]` and `stderr` only — NOT stdout. Stdout contains a normal `rate_limit_event` JSON that would otherwise false-match the quota patterns.
- **Output streaming**: posts a `🔄 Working...` comment immediately, then accumulates Claude's text output and posts incremental comments every 10s if there's >50 chars buffered, then posts any remaining text on completion. UI updates live via SSE.
- **Logger**: inline batched file logger writing to `logs/agent-runner-YYYY-MM-DD.log`. Mirrors to console.

### Frontend (apps/web)

- **Sidebar** (`components/sidebar.tsx`): two sections — Projects and Agents — both auto-refreshing every 10s. Each shows colored status dots, active item highlighted by URL.
- **Projects list** (`/projects`): card grid, status badges, "New Project" button.
- **New Project** (`/projects/new`): name + brief + optional Workspace Path with a **Browse...** button that opens `DirectoryPicker` (modal that calls `/filesystem/browse` and supports creating folders).
- **Project detail** (`/projects/:id`): tabs (Board / Tree / Agents). Shows project status as a clickable dropdown. **+ New Task** button opens a dialog with type selection (MVP / Sprint / Epic / Feature / Task / Subtask) and optional parent selection. If no parent is picked, the API client auto-creates the missing hierarchy via `ensureMvp / ensureSprint / ensureEpic / ensureFeature` helpers.
- **Board view**: kanban columns by task status (backlog, assigned, in_progress, blocked, review_request, done, cancelled). Click any task → opens `TaskDetail` sidebar.
- **TaskDetail sidebar**: status dropdown, agent assignment dropdown (shows ALL agents including master, not just developers), description, subtasks, comments. Has a `⛶` expand button that opens the full-page route. Header/footer fixed, middle scrolls. **Auto-scrolls to bottom only when NEW comments arrive**, not on every re-render.
- **Full-page task detail** (`/projects/:id/tasks/:taskId`): same content as the sidebar but full-width, with SSE auto-update.
- **Tree view** (`/projects/:id/tree`): collapsible hierarchy tree with status icons (`○◐◑⊘◎●⊗`) on every node — derived from descendant tasks for non-task nodes. Status + owner filters that hide non-matching subtrees. Clicking a task opens the same sidebar (not a new page).
- **Agent pool** (`/projects/:id/agents` and global `/agents`): grid of agent cards with status dots, role badges, "Create Agent" button. Click → agent detail.
- **Agent detail**: header with status, session ID, token count, **>_ Terminal** button. Three sections: In Progress (current event), Queue (pending), History (completed/failed/skipped). Auto-refreshes every 3s.
- **Web terminal** (`components/web-terminal.tsx`): fullscreen modal with xterm.js. Connects to `ws://localhost:3001/terminal`, sends `{ type: "init", agentId, projectId, cols, rows }`. Backend spawns interactive Claude with `--resume <session_id>` (no `-p`, no `--output-format`). Esc to close.
- **Realtime SSE**: `lib/stores/events-store.ts` connects to `/events/stream` and dispatches `comment_change`, `task_change`, `wake_event_change` events to subscribers. Used for live UI updates without polling.
- **Auto-refresh** on project page: when SSE fires `task_change` or `comment_change`, refetches.
- **xterm CSS** is served from `/public/xterm.css` (copied from node_modules) instead of importing the CSS module — Next.js had issues with the dynamic import.

---

## Conventions

### Code style

- **TypeScript everywhere**, strict mode on
- **No comments** unless the logic is non-obvious. Self-documenting code preferred.
- **No emojis in code** unless explicitly requested or already in the file
- **No defensive checks** for things that can't happen — trust internal code
- **Don't add error handling for hypothetical edge cases**
- Follow the existing patterns in neighboring files

### NestJS API

- One module per domain (actors, projects, etc.)
- Entity files: `<thing>.entity.ts`
- DTO files: `dto/create-<thing>.dto.ts`, `dto/update-<thing>.dto.ts`
- Use `class-validator` decorators on DTOs
- All imports use `.js` extension (Node16 module resolution)
- Inject the Logger from `@nestjs/common` with `private readonly logger = new Logger(MyService.name)`
- Log at INFO for state changes (created/updated/deleted), DEBUG for noisy reads
- Throw `BadRequestException` for client errors, `NotFoundException` for missing resources
- Status transitions are enforced server-side via constant maps (see `tasks.service.ts` and `projects.service.ts`)
- Wake events have a 60-second dedup window — when adding code that creates wake events, follow the same pattern (check pending/processing/recent-done first)

### TypeORM

- Use `relations: [...]` for eager loading when the consumer needs related data
- Foreign keys: `@ManyToOne(() => OtherEntity, { onDelete: 'CASCADE' })` + `@JoinColumn({ name: 'foo_id' })` + a separate `@Column({ name: 'foo_id' })`
- Self-references work (`task.parent_task_id`)
- `synchronize: true` is on, so any entity change auto-migrates on next API restart

### Frontend

- All pages are `"use client"` (no server components)
- Routing follows the file system: `app/projects/[id]/tasks/[taskId]/page.tsx`
- Fetching: `lib/api.ts` exports typed functions, NOT a hook library. Use `useEffect` + `useState`.
- State: prefer local component state. Use Zustand only for shared state (active project, tasks, actors, SSE events).
- Tailwind: dark theme baseline (`bg-gray-950`, `text-gray-100`). Status colors use a consistent palette (yellow=analysing/backlog, green=active/done, blue=in_progress, red=blocked/cancelled, purple=mvp/assigned, orange=epic/review_request).
- All forms have validation messages inline as `<p className="text-red-400 text-sm">`
- Modals use `fixed inset-0 bg-black/50 flex items-center justify-center z-50` (or `z-[60]`/`z-[100]` when nested)
- For new comments / streaming output, **only auto-scroll to bottom when the count actually increased** (use a `useRef` to compare prev length)

### Agent runner

- Inline batched file logger — don't add new logging dependencies
- All log calls go through `log()`, `warn()`, `error()`, `debug()` from `./logger.js`
- When adding a new error pattern, classify it in `claude-spawner.ts` `classifyError()` — only check `errors[]` and `stderr`, NEVER `stdout`
- Keep the runner sequential: 1 event at a time, no parallelism

### Logging

- Both API and runner write to `logs/{service}-YYYY-MM-DD.log`
- Use the file logger for everything important — these are the source of truth when debugging
- HTTP requests/responses are logged automatically by `LoggingInterceptor`
- pg_notify events are logged at DEBUG by `EventsGateway`

### Skill files

- `skills/developer.md` and `skills/master.md` are loaded by the prompt builder for NEW sessions only
- They're plain markdown — keep them human-readable
- The prompt builder finds them by walking up from `process.cwd()` looking for a directory containing `skills/master.md`
- When updating skill files, the changes apply to the NEXT new session — existing resumed sessions retain the old skill content in their conversation history

---

## Important Gotchas

1. **Don't add `incremental: true` to `apps/api/tsconfig.json`** — it breaks `nest start --watch` because tsc skips emitting if it thinks files haven't changed, but `deleteOutDir` already removed them
2. **Never trust `claude` to be on PATH** — always resolve via `execSync('which claude')` before spawning
3. **Don't use Node `child_process.spawn()` for Claude in interactive mode** — needs a real PTY (use `@homebridge/node-pty-prebuilt-multiarch`)
4. **Don't pass `-p` and expect to resume that session interactively later** — print-mode sessions can't be resumed in interactive mode (only with `--fork-session` or by providing another `-p`)
5. **Don't classify Claude errors by scanning `stdout`** — Claude streams a `rate_limit_event` JSON that contains the literal string `rate_limit` even when everything is fine
6. **Sessions are tied to the Claude account** — switching accounts invalidates them. Multi-account support is planned in `docs/roadmap/multi-account-sessions.md`
7. **Wake event dedup window is 60 seconds** — don't change this without thinking about whether agents will miss legitimate re-triggers
8. **The runner processes 1 event at a time on purpose** — don't parallelize without thinking through Claude session conflicts
9. **The watchdog will keep restarting the runner forever** — if you're debugging a startup crash, kill the watchdog process, not just the runner
10. **`embedded-postgres` PID file lies** — it will say a process is running when it's actually dead. Always also check port reachability via TCP socket

---

## Common Tasks

### Add a new entity / table

1. Create `apps/api/src/<domain>/<thing>.entity.ts` with TypeORM decorators
2. Create `apps/api/src/<domain>/<thing>.module.ts` and register the entity via `TypeOrmModule.forFeature([Thing])`
3. Add the module to `apps/api/src/app.module.ts` imports
4. Restart `pnpm dev` — TypeORM will auto-create the table via `synchronize: true`

### Add a new API endpoint

1. Add the controller method, decorate with `@Get()` / `@Post()` / etc.
2. Add the corresponding `service.ts` method
3. Add a typed function in `apps/web/lib/api.ts`
4. Use it in a component
5. The HTTP request/response will be logged automatically

### Add a new SSE channel

1. Add a `pg_notify` trigger SQL to `apps/api/src/events/pg-notify.setup.ts`
2. Add the channel to the LISTEN list in `events.gateway.ts`
3. The frontend `events-store.ts` already routes any channel to subscribers via `onEvent('channel_name', cb)`

### Add a new skill instruction for agents

1. Edit `skills/developer.md` or `skills/master.md`
2. **Existing resumed sessions won't pick up the change** — only new sessions get the updated skill
3. To force all agents to get the new skill: clear `actor.session_id` for everyone in the DB (or wait for natural session expiry)

### Debug "agent didn't wake up"

1. Check `logs/api-YYYY-MM-DD.log` for `Wake event ... created` — confirms the event was made
2. Check `logs/agent-runner-YYYY-MM-DD.log` for `Queue: N pending, processing 1` — confirms the runner picked it up
3. If runner picked it up but no `Done` / `Failed`, look for `Result: exit=...` to see what Claude returned
4. Check actor status — if stuck in `working`, the runner probably crashed mid-spawn (cleanup will reset on next restart)
5. Check `claude auth status` — confirm you're logged in
6. If quota error: check the actual error in the spawner log (`Error classified as QUOTA — matched pattern "..."`)

### Debug "task UI not updating"

1. Check the API log for `pg_notify received` — confirms the trigger fired
2. Check the API log for `SSE emit:` — confirms it was forwarded to clients
3. Check browser DevTools → Network → `events/stream` → confirm the EventSource is open and receiving messages
4. Check the relevant Zustand store has an `onEvent` listener subscribed

---

## Testing & Verification

There's no automated test suite. Verification is done by:

1. **Manual API test via curl** — see `tickets/13.md` for examples
2. **Browser interaction via Playwright MCP** — start services, navigate, click, screenshot. The QA tickets (`tickets/2.md`, `tickets/6.md`, etc.) use this approach.
3. **Reading log files** — `logs/api-*.log` and `logs/agent-runner-*.log` are the source of truth when debugging

When testing changes:
- Restart everything cleanly: `./start.sh` (kills ports + runs `pnpm dev`)
- Wait ~20 seconds for embedded Postgres + NestJS to fully boot before hitting endpoints
- Always check the log files, not just stdout — log files have everything

---

## Roadmap

Things that are designed but not built. Read these before starting on them so you don't reinvent decisions:

- [`docs/roadmap/multi-account-sessions.md`](../docs/roadmap/multi-account-sessions.md) — store one session_id per agent per Claude account, detect account switches, inject delta knowledge when resuming a stale session
- [`docs/roadmap/file-tree-editor.md`](../docs/roadmap/file-tree-editor.md) — file tree + Monaco editor on the project page, with copy/paste/create/delete and 5s polling for external changes
