# Binzbonz — Agent Orchestration Platform

## Agent Skills
- If you are a **developer** agent, read `skills/developer.md` for your workflow and guidelines.
- If you are **CTBACEO**, read `skills/ctbaceo.md` for your responsibilities.

## Project Memory
- Shared project context lives in the `memory/` directory (markdown files, git-tracked).
- Read relevant memory files before starting work.
- Propose updates via `memory_update` comment type.

## Repo Structure
- `apps/api/` — NestJS backend (port 3001)
- `apps/web/` — Next.js frontend (port 3000)
- `agent-runner/` — Wake event processor
- `skills/` — Agent skill files

## Development
- Package manager: pnpm
- `pnpm dev` — start all apps
- `pnpm build` — build all apps
