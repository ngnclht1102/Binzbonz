# Agent Orchestration Platform
## Business Requirements Document + Technical Architecture Document

---

## 1. Overview

A self-hosted platform that orchestrates a flat pool of Claude Code agents to autonomously build software projects. Humans define projects via a brief. CTBACEO agent analyses the brief, creates the full ticket hierarchy, assigns developers, and drives progress. Developers are event-driven — they wake only when mentioned. All agents share project memory as source of truth.

---

## 2. Core Concepts

### 2.1 Actors
Everyone in the system is an actor — human or agent.

| Type | Role | Wakes On |
|---|---|---|
| Human | — | — (uses UI) |
| Agent | `ctbaceo` | Heartbeat every 5 min |
| Agent | `developer` | @mention in comment |

### 2.2 Project Lifecycle
```
created → analysing → paused → active → completed
```
- `analysing` — CTBACEO only, breaking down brief into tickets
- `paused` — CTBACEO only, restructuring or waiting for human input
- `active` — all agents work
- `completed` — read only

### 2.3 Ticket Hierarchy
```
Project
└── MVP
    └── Sprint
        └── Epic
            └── Feature
                └── Task
                    └── Subtask
```
- MVP, Sprint, Epic, Feature — organisational, no agent work
- Task, Subtask — where agents work, each gets a git worktree

### 2.4 Agent Model
- All agents have equal permissions (`--dangerously-skip-permissions`)
- All developers share the same `developer.md` skill (via CLAUDE.md)
- CTBACEO has its own `ctbaceo.md` skill
- No org chart, no delegation chain, no permission logic
- Anyone (human or CTBACEO) can create new agents

### 2.5 Session Management
- Each agent has one persistent Claude session (`session_id`)
- Agent resumes session on every wake — no cold context rebuild
- After every wake, token count is read from stream-json output
- At 900k tokens → inject `/compact` on next wake (same session, same ID)
- At 960k tokens → force compact immediately
- Session ID never changes — compact happens in place

### 2.6 Git Worktree per Task
- One worktree per task, created when developer starts working
- Branched from latest `origin/main` at start time
- Worktree deleted after task merges to main
- `memory/` directory symlinked into every worktree (shared, not copied)

### 2.7 Shared Project Memory
- Lives at `project/memory/` — real markdown files, git-tracked
- All agents read natively via CLAUDE.md instructions
- Agents propose memory updates via `memory_update` comment type
- CTBACEO reviews, applies, and commits all memory changes
- On agent wake, runner injects only files changed since last active

### 2.8 Communication
- All communication happens via ticket comments
- @mentions trigger immediate wake of target agent
- CTBACEO scans all tasks on heartbeat, pings stuck agents
- comment_type drives behaviour: `update` | `block` | `question` | `review_request` | `handoff` | `memory_update`

---

## 3. Business Requirements

| ID | Requirement |
|---|---|
| BR-01 | Human creates a project by providing a name and plain-text brief |
| BR-02 | CTBACEO automatically analyses brief and creates full ticket hierarchy |
| BR-03 | CTBACEO assigns available developers to tasks evenly |
| BR-04 | Developers wake only when @mentioned, not on a schedule |
| BR-05 | CTBACEO runs on a heartbeat and pings stuck/idle agents |
| BR-06 | Any actor can create a new developer agent |
| BR-07 | All agents share project memory as source of truth |
| BR-08 | Memory updates are proposed via comments and applied by CTBACEO |
| BR-09 | Each task gets an isolated git worktree branched from latest main |
| BR-10 | Worktree is created by developer when starting, deleted after merge |
| BR-11 | Project can be paused — only CTBACEO works when paused |
| BR-12 | No login required — users identified by name stored in localStorage |
| BR-13 | Agent context is compacted at 900k tokens, never cold-restarted |
| BR-14 | All agent communication is via ticket comments, fully auditable |
| BR-15 | Human can comment on any ticket to guide or unblock agents |

---

## 4. Technical Architecture

### 4.1 Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 14 (app router) + Tailwind CSS |
| UI Components | shadcn/ui |
| Frontend State | Zustand |
| Realtime | Postgres LISTEN/NOTIFY via SSE |
| Backend | NestJS |
| Database | Embedded Postgres via `embedded-postgres@^18.1.0-beta.16` |
| ORM | TypeORM (`@nestjs/typeorm`) with `synchronize: true` in dev |
| Agent Runner | Node.js worker process (separate app in monorepo) |
| Queue | `wake_event` table — Postgres-backed, no Redis |
| Git | CLI via `execa` |
| Auth | None |

### 4.2 Embedded Postgres
- Uses `embedded-postgres@^18.1.0-beta.16` npm package (same as Paperclip)
- Platform-specific binaries (`@embedded-postgres/darwin-arm64`, `@embedded-postgres/linux-x64`, etc.)
- Supports two modes:
  - **Embedded** (default) — boots a real Postgres instance on NestJS startup, no external install required
  - **External** — set `DATABASE_URL` env var to skip embedded and connect to an existing Postgres
- Data persisted at `apps/api/data/postgres/` (gitignored)
- Connection via TypeORM pointed at embedded instance
- Default credentials: `binzbonz:binzbonz` on port `54329`
- Initialization sequence:
  1. Dynamically import `embedded-postgres`
  2. Check for existing cluster via `PG_VERSION` file
  3. Check for running process via `postmaster.pid` (reuse if alive)
  4. Remove stale `postmaster.pid` if process is dead
  5. Auto-detect next free port if configured port is busy
  6. `instance.initialise()` on first run (creates cluster with `--encoding=UTF8 --locale=C`)
  7. `instance.start()` to boot Postgres
  8. `ensureDatabase()` — create `binzbonz` database if not exists
  9. TypeORM `synchronize: true` handles schema on first run
- Graceful shutdown: `SIGINT`/`SIGTERM` handlers call `instance.stop()` before exit
- Constructor options:
  ```typescript
  new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "binzbonz",
    password: "binzbonz",
    port: selectedPort,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: appendLog,
    onError: appendLog,
  });
  ```

### 4.2.1 NestJS Database Module
- Custom `DatabaseModule` bootstraps embedded Postgres before TypeORM connects
- Exposes connection string to `TypeOrmModule.forRootAsync()` after embedded instance is ready
- TypeORM entities auto-loaded via `autoLoadEntities: true`
- `synchronize: true` in dev — no migration files needed

### 4.3 Repo Structure

```
/
├── apps/
│   ├── api/                  # NestJS backend
│   │   ├── src/
│   │   │   ├── actors/
│   │   │   ├── projects/
│   │   │   ├── hierarchy/    # mvps, sprints, epics, features
│   │   │   ├── tasks/
│   │   │   ├── comments/
│   │   │   ├── wake-events/
│   │   │   ├── events/       # SSE
│   │   │   ├── seed/
│   │   │   └── database/     # embedded postgres bootstrap + TypeORM config
│   │   └── data/
│   │       └── postgres/     # embedded db data dir (gitignored)
│   └── web/                  # Next.js frontend
│       └── app/
├── agent-runner/             # wake event processor
│   └── src/
├── skills/
│   ├── developer.md
│   └── ctbaceo.md
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

### 4.4 Database Schema (TypeORM entities)

```sql
-- ACTORS (humans + agents unified)
actor
  id                uuid PK
  name              text unique
  type              text          -- human | agent
  role              text          -- developer | ctbaceo | null
  avatar_url        text
  session_id        text
  last_token_count  int default 0
  last_active_at    timestamptz
  status            text default 'idle'   -- idle | working | compacting
  created_at        timestamptz

-- PROJECTS
project
  id              uuid PK
  name            text
  description     text
  brief           text
  repo_path       text
  main_branch     text default 'main'
  worktree_path   text
  claude_md_path  text
  status          text default 'analysing'
                  -- analysing | paused | active | completed
  created_at      timestamptz
  updated_at      timestamptz

-- HIERARCHY
mvp
  id, project_id FK, title, description, status, created_at

sprint
  id, mvp_id FK, title, goal, start_date, end_date, status, created_at

epic
  id, sprint_id FK, title, description, created_at

feature
  id, epic_id FK, title, description, acceptance_criteria, created_at

-- TASKS (+ subtasks via parent_task_id)
task
  id                  uuid PK
  feature_id          uuid FK
  parent_task_id      uuid FK self-ref nullable
  title               text
  description         text
  status              text default 'backlog'
                      -- backlog | assigned | in_progress | blocked
                      -- | review_request | done
  assigned_agent_id   uuid FK → actor
  branch_name         text
  worktree_path       text
  worktree_created_at timestamptz
  created_by          uuid FK → actor
  priority            int default 0
  created_at          timestamptz
  updated_at          timestamptz

-- COMMENTS
comment
  id            uuid PK
  task_id       uuid FK
  actor_id      uuid FK
  body          text
  comment_type  text default 'update'
                -- update | block | question | review_request
                -- | handoff | memory_update
  created_at    timestamptz

project_comment
  id, project_id FK, actor_id FK, body, comment_type, created_at

-- MEMORY FILES
memory_file
  id, project_id FK, file_path, last_updated_at,
  last_updated_by FK → actor, git_commit

-- WAKE EVENTS
wake_event
  id            uuid PK
  agent_id      uuid FK → actor
  project_id    uuid FK → project
  triggered_by  text
                -- mention | heartbeat | project_created | project_resumed
  comment_id    uuid FK → comment nullable
  status        text default 'pending'
                -- pending | processing | done | failed | skipped
  created_at    timestamptz
```

### 4.5 Agent Runner Logic

```
poll wake_events every 2s for status = pending

for each event:
  → mark status = processing
  → load actor + project
  → if project.status in (analysing, paused) and role != ctbaceo → skip
  → if actor.last_token_count > 960k → inject compact immediately
  → else if actor.last_token_count > 900k → inject /compact prompt
  → else → build delta prompt (new comments + memory changes)
  → spawn: claude --resume <session_id>
               --dangerously-skip-permissions
               --output-format stream-json
               -p "<prompt>"
  → stream parse:
      text blocks → write as comment on task
      result block → extract input_tokens
  → update actor: session_id, last_token_count, last_active_at, status
  → mark wake_event done
```

### 4.6 Mention Parser
On every comment insert:
- Parse `@name` mentions from body
- Look up matching actors where `type = agent`
- Insert `wake_event` for each with `triggered_by = mention`

### 4.7 Memory Sync on Wake
Before building agent prompt:
- Query `memory_file` where `last_updated_at > actor.last_active_at`
- If changed files exist, prepend list to prompt
- Agent re-reads only changed files, not full memory

### 4.8 Git Worktree Flow
```bash
# dev starts task
git fetch origin
git worktree add worktrees/task-<id> -b task/<id> origin/main
ln -s <repo>/memory worktrees/task-<id>/memory

# after merge
git worktree remove worktrees/task-<id>
git branch -d task/<id>
```

### 4.9 Realtime
- Postgres triggers on `comment`, `task`, `wake_event` tables call `pg_notify`
- NestJS SSE endpoint listens and streams to frontend
- Frontend `EventSource` updates Zustand store in real time

### 4.10 Frontend Routes
```
/                         → redirect /projects
/projects                 → project list
/projects/new             → create project form
/projects/:id             → board view (default)
/projects/:id/tree        → tree view
/projects/:id/agents      → agent pool
```

### 4.11 Skill Files
```
skills/
  developer.md    -- fullstack dev, self-QA, testing, worktree setup,
                     definition of done, memory read instructions
  ctbaceo.md      -- planning, breakdown, assignment, coordination,
                     QA review, memory guardianship, agent creation,
                     heartbeat scan behaviour
```
Both loaded natively via project `CLAUDE.md`.

### 4.12 Seed Data
Always seeded on dev startup (idempotent, runs after migrations):
- 1 CTBACEO agent
- 6 developer agents (dev-1 through dev-6)
- 1 human actor (brian)

### 4.13 TypeORM Configuration
- Entities co-located with their modules (e.g. `actors/actor.entity.ts`)
- `TypeOrmModule.forRootAsync()` receives connection string from `DatabaseModule`
- `synchronize: true` in dev — schema auto-synced from entity decorators
- `autoLoadEntities: true` — no manual entity registration needed

---

## 5. Non-Requirements (Phase 1)
- No authentication or login
- No cloud deployment (self-hosted only)
- No multi-model support (Claude only)
- No billing or token cost tracking UI
- No notification system beyond @mentions
- No PR/review UI (handled in terminal by human)
