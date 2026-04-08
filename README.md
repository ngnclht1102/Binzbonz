# Binzbonz — Agent Orchestration Platform

A self-hosted platform that orchestrates a pool of Claude Code agents to autonomously build software projects.

## Prerequisites

- **Node.js** >= 20
- **pnpm** >= 10

No external Postgres install needed — the API boots an embedded Postgres automatically.

## Quick Start

```bash
# Install dependencies
pnpm install

# Start all 3 services (API, Web, Agent Runner)
pnpm dev
```

| Service | URL | Description |
|---------|-----|-------------|
| API | http://localhost:3001 | NestJS backend + embedded Postgres |
| Web | http://localhost:3000 | Next.js frontend |
| Agent Runner | — | Polls wake events, spawns Claude sessions |

On first run, the API will:
1. Download and boot an embedded Postgres instance (port 54329)
2. Create all database tables via TypeORM sync
3. Seed 8 default actors (1 ctbaceo, 6 developers, 1 human "brian")

## Starting Services Individually

```bash
# API only (starts embedded Postgres)
pnpm --filter @binzbonz/api dev

# Web frontend only
pnpm --filter @binzbonz/web dev

# Agent runner only
pnpm --filter @binzbonz/agent-runner dev
```

## Using an External Postgres

Set `DATABASE_URL` to skip the embedded instance:

```bash
DATABASE_URL=postgres://user:pass@host:5432/binzbonz pnpm --filter @binzbonz/api dev
```

## Build

```bash
pnpm build
```

## Project Structure

```
├── apps/
│   ├── api/          NestJS backend (port 3001)
│   │   └── data/     Embedded Postgres data (gitignored)
│   └── web/          Next.js frontend (port 3000)
├── agent-runner/     Wake event processor
├── skills/
│   ├── developer.md  Developer agent instructions
│   └── ctbaceo.md    CTBACEO agent instructions
├── CLAUDE.md         Agent entry point
└── tickets/          Task breakdown (25 tickets)
```

## Setting Up a Project

Each project needs a **git repo** where agents will write code. When creating a project via the API, provide:

- `repo_path` — absolute path to the git repo (e.g. `/Users/you/Work/my-app`)
- `worktree_path` — where agent worktrees are created (e.g. `/Users/you/Work/my-app/worktrees`)

```bash
# Example: create a project pointing to an existing repo
curl -X POST http://localhost:3001/projects \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "My App",
    "brief": "Build a todo app with auth",
    "repo_path": "/absolute/path/to/your/repo",
    "worktree_path": "/absolute/path/to/your/repo/worktrees"
  }'
```

The repo must be a git repository with a `main` branch. Each task gets its own git worktree branched from `origin/main`, and a `memory/` symlink is created inside it for shared project context.

## How It Works

1. Human creates a project via the web UI with a name and brief
2. CTBACEO agent analyses the brief and creates the ticket hierarchy (MVP → Sprint → Epic → Feature → Task)
3. Agents are assigned to tasks — `@mention` in comments triggers a wake event
4. The agent runner picks up wake events, spawns Claude CLI sessions, and posts output as comments
5. All changes stream to the UI in realtime via Postgres LISTEN/NOTIFY + SSE
