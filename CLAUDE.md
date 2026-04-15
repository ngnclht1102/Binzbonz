# binbondev — Working on the Binzbonz Codebase

You are working on **Binzbonz**, a self-hosted agent orchestration platform. This skill describes what's built, the architecture, and the conventions to follow when adding features.

---

## What Binzbonz Is

A platform that orchestrates a flat pool of Claude Code agents to build software projects. Humans create projects with a brief; a Master agent breaks the brief into a ticket hierarchy and assigns work to developer agents. Developers wake on @mention or assignment, work in isolated git worktrees, and post progress as comments.

**Core idea:** every actor (human or agent) is a row in the `actor` table. Communication happens through ticket comments. Agents are woken via `wake_event` rows that the `agent-runner` polls. The runner spawns `claude` CLI sessions per agent, resumes them across runs, and streams output back as comments.

## Repo Layout

```
/
├── apps/
│   ├── api/                     NestJS backend (port 3001)
│   │   ├── src/
│   │   │   ├── actors/          actor entity + CRUD
│   │   │   ├── projects/        project entity + workspace setup
│   │   │   ├── hierarchy/       MVP/Sprint/Epic/Feature
│   │   │   ├── tasks/           tasks + subtasks + status transitions
│   │   │   ├── comments/        comments + mention parser → wake events
│   │   │   ├── wake-events/     wake event queue
│   │   │   ├── memory/          shared memory files
│   │   │   ├── seed/            seeds 8 default actors on startup
│   │   │   ├── database/        EmbeddedPostgresService + DatabaseModule
│   │   │   ├── events/          pg_notify triggers + SSE gateway
│   │   │   ├── terminal/        WebSocket gateway for interactive Claude sessions
│   │   │   ├── filesystem/      directory browser endpoints (used by New Project picker)
│   │   │   ├── dual-logger.ts   NestJS logger that writes to both console and file
│   │   │   ├── file-logger.service.ts  inline batched file logger
│   │   │   ├── logging.interceptor.ts  HTTP request/response logging
│   │   │   └── main.ts          bootstrap, port 3001, WS adapter
│   │   └── data/postgres/       embedded postgres data (gitignored)
│   └── web/                     Next.js frontend (port 3000)
│       ├── app/
│       │   ├── projects/        project list, new, detail (board/tree/agents/tasks)
│       │   ├── agents/          global agents list + detail (with terminal)
│       │   └── layout.tsx       sidebar layout
│       ├── components/
│       │   ├── sidebar.tsx           projects + agents nav
│       │   ├── web-terminal.tsx      xterm.js terminal modal
│       │   └── directory-picker.tsx  filesystem browse modal with mkdir
│       └── lib/
│           ├── api.ts           typed fetch wrapper for all endpoints
│           └── stores/          Zustand stores (projects, tasks, actors, events)
├── agent-runner/                worker process (TypeScript, ESM)
│   ├── src/
│   │   ├── index.ts             main loop + watchdog hooks
│   │   ├── api-client.ts        HTTP client to the API
│   │   ├── prompt-builder.ts    builds prompts from skill files + task context
│   │   ├── claude-spawner.ts    spawns claude CLI with retry/quota detection
│   │   ├── logger.ts            inline batched file logger
│   │   └── types.ts
│   └── watchdog.sh              auto-restarts the runner on crash
├── skills/
│   ├── developer.md             skill loaded for developer agents
│   ├── master.md               skill loaded for the Master agent
│   └── binbondev.md             this file — for working ON the codebase
├── docs/
│   ├── main_doc.md              original BRD + tech architecture
│   └── roadmap/
│       ├── multi-account-sessions.md   plan for per-account session storage
│       └── file-tree-editor.md          plan for project file browser + editor
├── tickets/                     25 numbered tickets, build-order checklist
├── logs/                        api-YYYY-MM-DD.log + agent-runner-YYYY-MM-DD.log
├── start.sh                     kill stale processes + run pnpm dev
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```