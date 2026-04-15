# Binzbonz Project Configuration

This file overrides global Binzbonz settings for this project. The settings
are inside the fenced `json` block below — edit the JSON to change the
behavior of agents working in this project. **Do not rename or delete the
fenced block; the runner parses it before every wake event.**

```json
{
  "default_branch": "main",
  "task_branch_template": "task/{task_id_short}",
  "auto_merge": true,
  "need_review_by_other_dev": false
}
```

## Settings

- **`default_branch`** (default `"main"`) — the integration branch the
  agent should merge/push task branches into when a task is done. Projects
  that keep `main` for production and develop on a different branch should
  set this to e.g. `"dev"`. The agent uses this value wherever its skill
  file references "main".

- **`task_branch_template`** (default `"task/{task_id_short}"`) — template
  for the branch name an agent creates for each task. Supported variables:
  - `{task_id}` — full UUID
  - `{task_id_short}` — first 8 chars of the UUID
  - `{title_slug}` — kebab-cased task title

- **`auto_merge`** (default `true`) — whether the agent may merge its own
  task branch into `default_branch` once tests pass. Set to `false` for
  projects that require human review before anything lands on the
  integration branch: the agent will push its branch to origin, set the
  task status to `review_request`, and post a comment with the branch
  name for a human to review + merge.

- **`need_review_by_other_dev`** (default `false`) — if `true`, developers
  do not mark their own tasks `done`. After self-review and tests pass,
  they set status to `review_request` and @mention the last idle developer
  in the handoff comment. That reviewer takes it from `review_request` to
  `done` once they approve.
