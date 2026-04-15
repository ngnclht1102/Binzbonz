# OpenAI-Compatible API Agents

## Problem

Today every agent in Binzbonz is a Claude CLI process — it spawns `claude` in a project workspace, has full tool access (Read/Edit/Bash/Git/etc.), and resumes via `--resume <session_id>`. This is the right model for **builders** that write code, edit files, run tests, and commit.

It is the wrong model for **coordinators / PM bots / lightweight workers** that should just:
- Read tasks and comments
- Post comments and @mentions
- Update task statuses
- Reassign work between developers
- Run cheaply and frequently

For these workloads we want a second agent kind backed by an **OpenAI-compatible HTTP API** (DeepSeek, Kimi/Moonshot, Groq, Together, vLLM, OpenRouter, raw OpenAI, etc.) — no PTY, no project workspace, no CLI tools — just messages-in / messages-out with **function calling** wrapped around our existing Binzbonz HTTP API.

This is also the carrier for the "no heartbeats for Claude" decision: heartbeat-style scheduled wake-ups will be handled by these OpenAI bots in a future iteration.

---

## Goals

1. Add two new roles: **`openapidev`** and **`openapicoor`**, each backed by an OpenAI-compatible HTTP API. Claude developers/master and OpenAI dev/coordinator coexist in the same `actor` table, the same wake event queue, and the same agent runner process.
2. **One runner, two spawners.** The runner reads `actor.role` and dispatches to either `claude-spawner` (today) or `openai-spawner` (new). Everything upstream (queue, dedup, processing-state machine, project gating) stays identical.
3. The OpenAI bot has **tool access only via Binzbonz's HTTP API** — never direct file system, shell, or git. Tools are JSON-schema definitions in the spawner that proxy to our own endpoints.
4. The OpenAI bot has **no project workspace, no CLI, no PTY**. Pure HTTP-in/HTTP-out.
5. Conversation state is **persisted by us**, not by the provider — every prior message is replayed on every call. Stored per `(agent, project)` in the same `agent_project_session` table.
6. **Conversation viewer is interactive** — humans can type into the modal to chat with the bot directly, not just read its history.
7. Reuse the same skill file mechanism. Same comment-as-output channel. Same UI surfaces.

---

## Roles

We add **two new roles** to the existing `developer` / `master` enum:

| Role | Skill file | Provider | Purpose |
|---|---|---|---|
| `developer` | `skills/developer.md` | Claude CLI | Builds code in a project workspace |
| `master` | `skills/master.md` | Claude CLI | Coordinates Claude developers, breaks down briefs |
| `openapidev` | `skills/openapidev.md` (new) | OpenAI-compatible | Lightweight dev assistant — reads tasks, posts comments, light coordination work, no file editing |
| `openapicoor` | `skills/openapicoor.md` (new) | OpenAI-compatible | Coordinator equivalent of master — runs cheaply, scans work, reassigns, nudges stuck agents |

The role itself determines which spawner runs:

```ts
const isOpenAI = actor.role === 'openapidev' || actor.role === 'openapicoor';
const result = isOpenAI
  ? await spawnOpenAI(actor, sessionState, prompt, project)
  : await spawnClaude(sessionState.session_id, prompt, project.repo_path, onChunk);
```

No separate `provider` column — the role IS the provider indicator. Cleaner mental model: each role has its own skill file, its own runtime.

The new skill files (`openapidev.md`, `openapicoor.md`) are explicitly written for an HTTP-tool-calling bot — they describe the available tools, what the bot can and cannot do, and the comment-only output channel. They are NOT just copies of `developer.md` / `master.md`.

---

## What an OpenAI bot can actually DO

**Yes:**
- Read its assigned tasks, read comments, read task descriptions
- Post comments (including @mentions to wake other agents)
- Update task status
- Reassign tasks between developers
- Read memory files (text content, via API)
- List projects, list agents, query who's idle

**No (out of scope, deliberately):**
- Edit files in the project workspace
- Run shell commands
- Make git commits / branches / pushes
- Run tests
- Anything that requires a file system or shell

A useful mental model: the OpenAI bot is **a coordinator that types**, not a developer that codes. Even an `openapidev` (despite the name) coordinates through comments — it doesn't write source code in this v1.

---

## Database Schema

### Extend `actor`

```sql
actor
  ...existing columns...
  provider_base_url     text nullable    -- e.g. 'https://api.deepseek.com/v1'
  provider_model        text nullable    -- e.g. 'deepseek-chat' or 'moonshot-v1-32k'
  provider_api_key      text nullable    -- raw API key, stored in DB
```

Three new columns. Only populated when role is `openapidev` or `openapicoor`. The validation rule:

- Role `developer` / `master` → all three new columns must be NULL
- Role `openapidev` / `openapicoor` → all three new columns must be set

**Storing the API key in the DB.** The user explicitly chose this over env-var indirection. Trade-offs documented:
- ✅ Easy UX — set the key once from the UI, no shell config required
- ✅ Multi-tenant friendly — different agents can use different keys without env namespace collisions
- ⚠ Key appears in DB backups — anyone with file access to `data/postgres/` has the key
- ⚠ Key appears in `pg_dump` output — be careful when sharing dumps
- ⚠ Key leaks in logs unless we redact — the API client must scrub `Authorization` headers from request logs

**Mitigation:** the API and runner MUST redact `provider_api_key` whenever logging an actor row, and MUST never log the `Authorization` header value of outbound provider calls. Add a single `redactActor()` helper used everywhere we log actors. Same for the `lib/api.ts` client on the web side — strip the field before sending to React state if we ever decide to display it (we won't).

### Extend `agent_project_session`

```sql
agent_project_session
  ...existing columns...
  message_history       jsonb default '[]'   -- only used by openapi* agents
```

For Claude rows this stays empty. For OpenAI rows it stores the full messages array we send back on every call:

```json
[
  { "role": "system",    "content": "<skill file + identity>" },
  { "role": "user",      "content": "Task assigned: ..." },
  { "role": "assistant", "content": null, "tool_calls": [...] },
  { "role": "tool",      "tool_call_id": "...", "content": "..." },
  { "role": "assistant", "content": "Reviewed and posted" }
]
```

The `last_token_count` column already exists and is reused for OpenAI total token usage. Same compaction trigger pattern.

---

## Context Injection & Continuity

(See the chat I gave you for the full mental model — this is the implementation form.)

### Three layers of context

| Layer | What | Sent how | Sent when |
|---|---|---|---|
| **Identity & rules** | skill file + actor_id + project_id | `role: system` message | Once per `(agent, project)` pair, on first wake |
| **Task / project state** | current task, recent comments, project status, memory deltas | `role: user` message | Every wake event, built fresh from the DB |
| **Tool results** | what `get_task` / `get_comments` etc. returned | `role: tool` message | Mid-loop, in response to `tool_calls` from the model |

### Continuity mechanism

We own the message history. The provider is stateless. Every wake event:

```
1. LOAD     history = sessionRow.message_history ?? []
2. APPEND   if first wake: push system message (skill file + identity)
            push user message (task context built from DB)
3. LOOP     while true:
              response = openai.chat.completions.create(
                model, messages: history, tools, stream: false
              )
              push response.message
              if response.message.tool_calls:
                for each call:
                  result = executeTool(call, actor, project)
                  push { role: tool, tool_call_id, content: JSON.stringify(result) }
                continue
              break
4. PERSIST  upsert agent_project_session.message_history = history
            update last_token_count, last_active_at
```

On the next wake, step 1 reloads the same history including everything from prior wakes. The bot sees a continuous conversation: "two days ago you reviewed task X, yesterday you assigned it to dev-2, today there's a new comment on it — what do you do?"

### Tool round budget: 50

Hard cap per wake event. If the loop exceeds 50 rounds we break, post a `block` comment ("exceeded tool call budget — possible loop"), and mark the wake event failed. 50 leaves comfortable headroom for legitimate multi-step coordination work but prevents runaway costs.

### Persistence: end of wake only

We persist `message_history` once at the end of the wake event, not after every tool round. Simpler, one upsert per wake. If the runner crashes mid-loop the in-progress wake is lost — the next wake rebuilds context fresh from the prior persisted state. Acceptable.

---

## Context Window Compaction

When `last_token_count` crosses a threshold (e.g. **80% of the model's max context window**), we compact the history before the next call. The strategy is **keep system + summarize middle + keep last N**:

```
Before:
  [system, user_1, asst_1, tool_1, asst_1b, ..., user_N, asst_N]
  (length = 200, total_tokens = 90k of 100k context)

After:
  [
    system,                                            ← always kept
    {role: assistant, content: "Summary of earlier:   ← compacted middle
      reviewed task X, posted 3 comments, assigned
      task Y to dev-2, dev-2 reported blocker..."},
    user_(N-K+1), asst_(N-K+1), ..., user_N, asst_N    ← last K rounds verbatim
  ]
```

### Algorithm

1. **Detect:** if `last_token_count > 0.8 * model_context_window` after a wake completes, mark the row for compaction. The model context window is per-model — store it in a small constant table keyed by model name (`'deepseek-chat': 64000`, `'moonshot-v1-128k': 128000`, etc.). Default to 32k if unknown.
2. **Trigger:** at the start of the *next* wake (before sending), if compaction is pending, run it inline.
3. **Split:** identify the **last K rounds** to keep verbatim (default K = 6 rounds, so ~12 messages including tool results). Everything between the system message and that tail is the "middle" to summarize.
4. **Summarize:** make a one-shot call to the same provider with a prompt like:
   ```
   You are summarizing your own past activity for context compression.
   Below are messages from your prior work session. Produce a concise
   summary (under 1500 chars) of: what tasks you handled, what decisions
   you made, what comments you posted, what's still in flight.

   <serialized middle messages>
   ```
5. **Replace:** the new history is `[system, {role: assistant, content: summary}, ...last_K_messages]`.
6. **Persist** the compacted history. The token count drops; the next regular wake proceeds normally.

### Why this shape

- **System message stays verbatim** — it has the skill file, identity, tool descriptions. Losing it would break the bot.
- **Last K rounds stay verbatim** — recent context (the current task, the latest comments) needs full fidelity for the bot to act correctly.
- **Middle gets summarized** — old tool calls, old comments, old reasoning chains compress well into prose. Lossy but cheap.
- **The summary is itself an `assistant` message** — fits naturally into the conversation flow. The bot reads it as "this is what I remember about my earlier work."

### Edge cases

- If the **first wake** already exceeds the window (huge skill file + huge task description) → fail with a clear comment, no compaction possible (nothing to summarize). Means the operator needs to shorten the skill file or pick a model with a bigger window.
- If the **summarization call itself** fails (network, rate limit) → log it, skip compaction this round, the original history is retained. Next wake retries.
- If after summarization the history is *still* over the threshold → drop the oldest verbatim tail messages one round at a time until it fits, with a warning logged.

### Manual reset

The existing `DELETE /agent-project-sessions/:id` endpoint nukes the row entirely. Use it as a "start fresh" escape hatch when compaction misbehaves.

---

## Tool Layer

Tools are defined once, statically, in `agent-runner/src/openai-tools.ts`. Each is a JSON schema plus an executor function. The executor closes over `actor`, `project`, `event` so the model can't address tasks / projects it shouldn't.

**v1 tool set (9 tools):**

| Tool | Maps to | Purpose |
|---|---|---|
| `list_my_tasks` | `GET /actors/:id/tasks` (new) | What am I assigned to? |
| `get_task` | `GET /tasks/:id` | Read task title, description, status |
| `get_task_comments` | `GET /tasks/:id/comments` | Read recent comments on a task |
| `post_comment` | `POST /tasks/:id/comments` | Post a comment (with optional @mention) |
| `update_task_status` | `PATCH /tasks/:id` | Move task between statuses |
| `assign_task` | `PATCH /tasks/:id` | Assign to a developer (wakes them) |
| `list_idle_developers` | `GET /actors?role=developer&status=idle` | Who's free? |
| `list_project_tasks` | `GET /projects/:id/tasks` | Scan all tasks in the project |
| `read_memory_file` | `GET /projects/:id/memory-files/:path` | Read shared project context |

The bot's `actor_id` and the wake event's `project_id` are **scoped at tool dispatch time** — the bot can't post a comment as another user, or operate on tasks outside its project. We never accept these as model parameters; the spawner injects them when calling the local API.

**Explicitly NOT in v1:**
- Creating new tasks (`create_task`)
- Writing memory files (`write_memory_file`)
- Direct wake event creation (the bot wakes others by posting `@mention` comments, which already triggers the mention parser)
- Anything filesystem / shell / git
- Cross-project tools (the bot is locked to the wake event's project)

### Tool execution

The spawner makes localhost HTTP calls to `http://localhost:3001` with the same client used by `agent-runner` for everything else. This means tool calls go through the existing validation, logging, dedup, and pg_notify pipeline — the UI updates in real time when the bot posts comments or assigns tasks.

If a tool call fails (HTTP 4xx/5xx), we return the error message as the tool result content and let the model decide what to do next. We do NOT retry inside the tool dispatch.

---

## Provider Setup

The first provider we'll point this at: **DeepSeek or Kimi (Moonshot)** — user will provide the API key during testing. Both are OpenAI-compatible and support function calling.

### Suggested defaults (UI placeholders, not enforced)

| Provider | Base URL | Suggested Models |
|---|---|---|
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat`, `deepseek-reasoner` |
| Kimi (Moonshot) | `https://api.moonshot.cn/v1` | `moonshot-v1-32k`, `moonshot-v1-128k` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini`, `gpt-4o` |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| OpenRouter | `https://openrouter.ai/api/v1` | varies |

### Test Connection button

The agent creation dialog has a **Test Connection** button next to the provider fields. Clicking it makes a one-shot call to `{base_url}/models` with the provided API key:
- 200 → green check + the model list (so the user can verify their `model` choice exists)
- 401/403 → red "API key rejected"
- Other → red error message

This catches typos before the agent is created and tries its first wake event.

---

## Spawn Flow

The runner's `processEvent()` already has `actor`, `project`, and `sessionState` in scope. Add a single dispatch:

```ts
const isOpenAI = actor.role === 'openapidev' || actor.role === 'openapicoor';

if (isOpenAI) {
  result = await spawnOpenAI({
    actor,
    project,
    event,
    sessionState,
    onProgress: progressCallback,
  });
} else {
  result = await spawnClaude(sessionState.session_id, prompt, project.repo_path, onChunk);
}
```

`spawnOpenAI` lives in a new `agent-runner/src/openai-spawner.ts`. It returns the same `SpawnResult` shape as `spawnClaude` so the runner's downstream logic (comment posting, error handling, fatal-error path) doesn't need to know which spawner ran.

### Errors

| Error | Action |
|---|---|
| HTTP 401/403 | Fatal — comment "API key rejected for {actor.name}" and stop. Do not retry. |
| HTTP 429 (rate limit) | Fatal — comment and stop. Same as Claude quota path. |
| HTTP 5xx | Retry 3x with the existing 2s/4s/8s backoff. After all retries, mark wake event failed. |
| Network / timeout | Retry 3x with backoff. |
| Tool execution returns error | Return as tool message content, model decides what to do. No retry. |
| Tool round budget exceeded (50) | Fatal — comment "exceeded tool call budget" and stop. |
| Provider returns malformed JSON | Fatal — comment with the raw response (truncated). |

### Streaming + progress comments — KEEP (matches Claude UX)

Same UX as Claude: post a `🔄 Working...` comment immediately at wake start, then progress comments every 10s while the bot is producing output, then a final comment at the end of the wake.

Implementation:
- Use `stream: true` on the OpenAI request so we get token-by-token deltas
- Buffer the deltas the same way the Claude flow does (10s buffer + threshold of 50 chars before posting a comment chunk)
- For tool-call rounds (which have no text), post a brief progress note like `🛠 calling get_task_comments...` so the user sees activity even when the model is in a tool loop
- The final assistant text becomes the last `update` comment

The runner-side comment buffering and the 10s timer pattern are already implemented for Claude — reuse the same code path. The OpenAI spawner just needs to call `onTextChunk` whenever a delta arrives.

---

## Heartbeat

Periodic, scheduled wake-ups for a coordinator bot. Replaces the Claude heartbeat we removed earlier. Designed to power "scan all tasks every 5 minutes, ping stuck agents, reassign idle work" patterns.

### Hard constraint: at most ONE bot with heartbeat enabled

Across the entire system, only one actor row can have `heartbeat_enabled = true`. Trying to enable it on a second actor returns **HTTP 409 Conflict** with a message naming the actor that already owns it. Service-level enforcement in v1 (a partial unique index is documented as v2 hardening).

Why one: heartbeats fan out to multiple wake events per tick (see "What a tick fires" below). Two heartbeat bots would double the wake event load and step on each other's coordination decisions. The user explicitly asked for this constraint.

### Schema

Add to `actor`:

```sql
actor
  ...
  heartbeat_enabled              boolean     default false
  heartbeat_interval_seconds     int         default 300
  heartbeat_last_at              timestamptz nullable
```

`heartbeat_interval_seconds` minimum: **30 seconds** (validated). Anything smaller is rejected — the cron poll rate is the floor and we don't want runaway loops.

Cascade-delete works as today: drop the agent → these columns go with it.

### What a tick fires

When the heartbeat fires, the cron job:

1. Loads the heartbeat-enabled actor (if any)
2. Looks up every `agent_project_session` row for that actor
3. For each row whose project status is **not `completed`**, creates ONE wake event with `triggered_by='heartbeat'` and `project_id` set to that project
4. Updates `actor.heartbeat_last_at = now()`

So **N projects = N wake events per tick**. The bot processes them sequentially through the existing one-at-a-time queue. On a 5-minute interval with 3 active projects, that's 3 wake events every 5 minutes — fine.

**Bootstrap requirement:** the bot only fires heartbeat events for projects where it already has a session row. To onboard a new project, the user assigns a task to the bot once in that project (which creates the session row). After that, the heartbeat takes over. This is the cleanest way to scope the heartbeat — no "scan every project" explosion.

### Trigger handling in the prompt builder

A new `triggered_by='heartbeat'` value. The prompt builder generates a different user message for these:

```
This is a scheduled heartbeat check. Scan the active tasks in this project.
Look for:
  - Tasks in `assigned` or `in_progress` with no recent activity (use list_project_tasks + get_task_comments)
  - Tasks in `blocked` that may have been unblocked
  - Tasks in `backlog` that should be assigned to an idle developer (use list_idle_developers)
  - Open `review_request` tasks that lack a reviewer

If you find issues, take action via tools (post comments, reassign, change status).
If everything looks healthy, do nothing — return a one-line "all clear" assistant message.
```

This is layered with the same task / project context the prompt builder already produces — heartbeats just append this instruction block instead of "you have been assigned to this task".

### Cron / scheduler

Use `@nestjs/schedule` (`@Cron` decorator) in a new `apps/api/src/heartbeat/heartbeat.service.ts` module.

```ts
@Cron('*/30 * * * * *')   // every 30 seconds
async tick() {
  const bot = await this.actorRepo.findOne({ where: { heartbeat_enabled: true } });
  if (!bot) return;

  const elapsed = Date.now() - (bot.heartbeat_last_at?.getTime() ?? 0);
  if (elapsed < bot.heartbeat_interval_seconds * 1000) return;

  // Fire wake events for every active session of this bot
  const sessions = await this.sessionsService.findByAgent(bot.id);
  for (const s of sessions) {
    if (s.project.status === 'completed') continue;
    await this.wakeEventsService.create({
      agent_id: bot.id,
      project_id: s.project_id,
      triggered_by: 'heartbeat',
    });
  }

  bot.heartbeat_last_at = new Date();
  await this.actorRepo.save(bot);
}
```

The 30-second cron rate is the **resolution floor**. If the bot's interval is 300 seconds, the worst-case latency is 30s on top of that. Acceptable; documented in the UI ("interval is approximate, ±30s").

### Dedup considerations

The existing wake-event dedup window (60s across pending/processing/done) protects against duplicate heartbeats if two ticks fire close together. So even if the cron misfires or the runner is slow, we don't pile up duplicate heartbeat wakes for the same `(agent, project)`.

### Failure modes

| Failure | Behavior |
|---|---|
| Heartbeat tick happens while bot is mid-wake on something else | New wake event queues, processed after the current one finishes |
| Bot's project session row is deleted between ticks | Skipped on the next tick — bot stops scanning that project |
| Bot is deleted entirely | Cascade clears its session rows; heartbeat ticks find no bot, become a no-op |
| Cron job crashes | NestJS scheduler restarts it on the next interval; `heartbeat_last_at` ensures we don't double-fire |
| Bot's API quota / key is broken | Wake event fails like any other; next tick tries again |

### API endpoint

```
PATCH /actors/:id/heartbeat
Body: { enabled: boolean, interval_seconds?: number }
```

Service logic:

```ts
async setHeartbeat(id: string, enabled: boolean, interval: number) {
  if (enabled) {
    const existing = await this.actorRepo.findOne({
      where: { heartbeat_enabled: true, id: Not(id) },
    });
    if (existing) {
      throw new ConflictException(
        `Heartbeat is already enabled for "${existing.name}". Disable it first.`,
      );
    }
    if (interval < 30) {
      throw new BadRequestException('interval_seconds must be >= 30');
    }
  }
  const actor = await this.findOne(id);
  actor.heartbeat_enabled = enabled;
  if (enabled) actor.heartbeat_interval_seconds = interval;
  return this.actorRepo.save(actor);
}
```

### UI

On the agent detail page (only for `openapidev` / `openapicoor` roles), add a **Heartbeat** card:

```
┌─────────────────────────────────────────────┐
│ Heartbeat                                   │
├─────────────────────────────────────────────┤
│ [×] Enable heartbeat                        │
│                                             │
│ Interval: [ 300 ] seconds   (≥ 30, ±30s)    │
│                                             │
│ Last tick: 2 minutes ago                    │
│ Next tick: in ~3 minutes                    │
│                                             │
│ Will fire one wake event per tick for each  │
│ active project where this bot has a session │
│ (currently 3 projects).                     │
│                                             │
│ [Save]                                      │
└─────────────────────────────────────────────┘
```

If another bot already has heartbeat enabled, the toggle is **disabled** and shows: `Heartbeat is owned by "master-deepseek". Disable it there first.` (with a link to that agent's page).

The Save button calls `PATCH /actors/:id/heartbeat`. On 409, surface the error message inline.

The "Last tick" / "Next tick" labels live-update from the polled actor record (3s refresh, same as the rest of the agent detail page).

---

## Provider Config Update API

Separate from agent creation. Used to rotate API keys, change models, or update base URLs without recreating the agent.

### Endpoint

```
PATCH /actors/:id/provider-config
Body: { base_url?: string, model?: string, api_key?: string }
```

Only valid for `openapidev` / `openapicoor` roles. Returns 400 if the actor is a Claude role.

The body fields are all optional — only provided fields are updated. The API key field is **write-only**: it's never returned in any response. To rotate, the user enters the new key; the old one is overwritten in place.

### Optional verification

If the request includes `api_key`, the controller can optionally verify the key works before saving by hitting `{base_url}/models`. Behind a `?verify=true` query param so the UI can opt in (the Test Connection button uses this; bulk updates can skip).

### Service-level redaction

`redactActor()` strips `provider_api_key` from every response. The Update Provider Config endpoint also returns the redacted actor.

### UI

On the agent detail page, replace the static provider info display with an editable card:

```
┌─────────────────────────────────────────────┐
│ Provider Config                             │
├─────────────────────────────────────────────┤
│ Base URL: [https://api.deepseek.com/v1]     │
│ Model:    [deepseek-chat              ▼]    │
│ API Key:  [••••••••••••••••]   [Replace]    │
│                                             │
│ [Save]            [Test Connection]         │
└─────────────────────────────────────────────┘
```

The API key field shows masked dots and a "Replace" button. Clicking Replace clears the field and shows an empty input where the user types the new key. Save sends the PATCH. Test Connection sends with `?verify=true` and reports the result inline.

---

## Interactive Conversation Viewer / Chat

This is bigger than a viewer — it's a **chat UI** where humans can type messages directly into the bot's conversation history.

### UX

For every OpenAI agent on its detail page (and per project session row):

```
┌────────────────────────────────────────────────┐
│ deepseek-coord — Project A          [×] close  │
├────────────────────────────────────────────────┤
│                                                │
│  🤖 system  (skill file + identity)            │
│                                                │
│  👤 user                                       │
│  Wake #1: assigned to task "Setup DB"          │
│                                                │
│  🤖 assistant  (calling get_task...)           │
│  🛠 tool result  {"status":"backlog",...}      │
│                                                │
│  🤖 assistant                                  │
│  I've reviewed the task and will assign it     │
│  to dev-2 after checking who's idle.           │
│                                                │
│  👤 user                                       │
│  Why dev-2 specifically? Pick dev-3 if free.   │   ← human typed
│                                                │
│  🤖 assistant  (calling list_idle_developers)  │
│  ...                                           │
│                                                │
├────────────────────────────────────────────────┤
│ [Type a message...                  ] [Send]   │
└────────────────────────────────────────────────┘
```

### Send flow

When the human types and hits Send:

1. Frontend posts to **new endpoint** `POST /agent-project-sessions/:id/chat` with `{ content: "Why dev-2..." }`
2. The endpoint:
   - Validates the agent is `openapi*`
   - Loads the session row
   - Appends `{ role: 'user', content: <text> }` directly to `message_history`
   - Saves the row
   - Creates a wake event with `triggered_by='chat'`
   - Returns `202 Accepted`
3. The agent runner picks up the wake event on its next 2s poll
4. Sees `triggered_by='chat'` → **skips the build-context-from-task step** (the user message is already in history). Just runs the spawner directly with the existing history.
5. Spawner does its tool-call loop, persists the updated history at the end
6. Modal polls `GET /agent-project-sessions/:id/messages` (see "Modal data" below) every 1s and re-renders when new messages appear

### Wake event triggered_by extension

Add a new value to the `triggered_by` enum: `'chat'`. The runner's user-message-building logic skips when this is set, since the user message is already in history.

### Polling vs SSE

v1 uses **simple polling** every 1s while the modal is open. SSE / live updates is a v2 enhancement once we know the polling overhead matters. Polling stops when the modal closes.

### Edge cases

- **Modal open but agent busy on a wake event** — the chat send still appends the user message to history immediately, but the wake event sits in the queue until the in-flight wake completes. The user sees "queued" briefly before the bot replies.
- **Two humans chatting at once** (rare but possible) — both messages append in DB-write order, both wake events queue up, the bot sees both messages on its next run. No special handling needed.
- **Human sends a message while the bot is mid-tool-loop** — the new user message appends to history but won't be seen by the bot until the in-flight loop finishes (because we persist at end of wake). Acceptable.

---

## API Changes

### New endpoints

```
GET    /actors/:id/tasks                              List tasks assigned to this actor
PATCH  /actors/:id/heartbeat                          Toggle heartbeat + set interval
PATCH  /actors/:id/provider-config                    Update base_url / model / api_key
                                                      Optional: ?verify=true validates the key
GET    /agent-project-sessions/:id/messages           Get the message_history for one row
POST   /agent-project-sessions/:id/chat               Send a chat message (creates wake event)
```

### Modified endpoints

`POST /actors` — accept the new role values and provider fields:

```json
{
  "name": "deepseek-coord",
  "type": "agent",
  "role": "openapicoor",
  "provider_base_url": "https://api.deepseek.com/v1",
  "provider_model": "deepseek-chat",
  "provider_api_key": "sk-..."
}
```

Validation:
- If `role` is `openapidev` or `openapicoor` → all three provider fields required
- If `role` is `developer` or `master` → all three provider fields must be absent (or rejected)

`GET /agent-project-sessions?...` — **strip** `message_history` from the response. The list endpoint stays light (could be megabytes per agent otherwise). The dedicated `/messages` endpoint is the only way to get the full history.

Same goes for `GET /agent-project-sessions?agent_id=X&project_id=Y` (single row) — we should still strip `message_history` for symmetry, but include the message count + total token count instead.

### API key redaction

A `redactActor()` helper used wherever we log or return actor data:

```ts
function redactActor(a: Actor): Actor {
  return { ...a, provider_api_key: a.provider_api_key ? '<redacted>' : null };
}
```

Apply in:
- All actor list/detail responses (the API key is NEVER returned to the frontend after creation)
- All log lines that include actor data
- The runner's logging when fetching an actor

The frontend never sees the API key after creation. To rotate it, the user re-enters it.

---

## UI Changes

### Agent creation dialog

The current "New Agent" dialog has only `name` + `role`. After this:

```
┌────────────────────────────────────────────────┐
│ New Agent                                      │
├────────────────────────────────────────────────┤
│ Name:    [_________________]                   │
│ Role:    ◯ developer  (Claude CLI)             │
│          ◯ master    (Claude CLI)             │
│          ◯ openapidev (OpenAI-compatible API)  │
│          ◯ openapicoor(OpenAI-compatible API)  │
│                                                │
│ ─ if openapidev or openapicoor: ─              │
│ Base URL: [https://api.deepseek.com/v1]        │
│ Model:    [deepseek-chat]                      │
│ API Key:  [sk-_______________]      [Test]     │
│   ⚠ stored in DB; rotate by re-entering        │
└────────────────────────────────────────────────┘
```

### Agent detail page

Add a small icon next to the agent name: **🤖** for Claude (CLI), **🌐** for OpenAI. Tooltip on hover shows provider details (base URL, model).

For OpenAI agents, the **"Project Sessions"** table replaces the `session_id` column with a `messages` count (e.g. "12 msgs") and the existing `tokens` column shows total tokens. Clicking opens the chat modal for that `(agent, project)` pair.

### Sidebar / global agent list

Same icon convention. Lists stay compact — just `🌐 deepseek-coord` instead of `dev-3`.

### Web terminal

OpenAI agents don't have a PTY. The "Open Terminal" button is **hidden** for them. Instead, show **"Open Conversation"** which opens the chat modal (header button) — same modal accessible from per-row links in the Project Sessions table.

### Agents tab on the project page

For each agent row, show the icon and a small "active session" indicator (filled = has session, hollow = no session yet, same convention as before).

---

## Implementation Order

1. **Schema:** add to `actor`: `provider_base_url`, `provider_model`, `provider_api_key`, `heartbeat_enabled`, `heartbeat_interval_seconds`, `heartbeat_last_at`. Add `message_history` jsonb to `agent_project_session`. TypeORM `synchronize: true` migration.
2. **Skill files:** write `skills/openapidev.md` and `skills/openapicoor.md`.
3. **API:**
   - Extend `CreateActorDto` and validation (provider fields required if openapi* role)
   - Add `redactActor()` helper, apply to all actor responses
   - New endpoint `GET /actors/:id/tasks`
   - New endpoint `PATCH /actors/:id/heartbeat` (with single-bot constraint)
   - New endpoint `PATCH /actors/:id/provider-config` (with optional `?verify=true`)
   - Strip `message_history` from `agent_project_sessions` list responses
   - New endpoint `GET /agent-project-sessions/:id/messages`
   - New endpoint `POST /agent-project-sessions/:id/chat`
   - Add `'chat'` and `'heartbeat'` to wake event `triggered_by` values
4. **Heartbeat scheduler:**
   - New `apps/api/src/heartbeat/heartbeat.module.ts` with `@nestjs/schedule`
   - `HeartbeatService` with `@Cron('*/30 * * * * *')` tick handler
   - Loads heartbeat-enabled actor, checks elapsed, fans out wake events to active project sessions, updates `heartbeat_last_at`
5. **Agent runner:**
   - Create `openai-spawner.ts` with the tool-call loop (50-round budget) and streaming progress comments
   - Create `openai-tools.ts` with the 9 v1 tool definitions and executors
   - Create `openai-compactor.ts` with the keep-system + summarize-middle + keep-last-N algorithm
   - In `index.ts`, dispatch on `actor.role` after building `sessionState`
   - For `triggered_by='chat'`, skip the build-user-context step (user message is already in history)
   - For `triggered_by='heartbeat'`, build a heartbeat-style instruction block (see Heartbeat section)
   - Persist `message_history` after spawn
6. **Frontend:**
   - Update `Actor` type in `lib/api.ts` (new fields, but never expose API key)
   - New API helpers: `getAgentMessages`, `chatWithAgent`, `testProviderConnection`, `setHeartbeat`, `updateProviderConfig`
   - New Agent dialog → role picker with conditional fields + Test Connection button
   - Agent badges → icon convention (🤖 / 🌐)
   - Agent detail page (OpenAI agents):
     - Provider Config card (editable, with Test Connection)
     - Heartbeat card (toggle + interval, disabled if another bot owns it)
     - Project Sessions table → adapt for openai bots (msgs count instead of session_id)
     - Hide Terminal button, show "Open Conversation"
   - **Chat modal component** (`apps/web/components/agent-chat.tsx`):
     - Renders messages as bubbles by role
     - Tool calls and tool results collapsed by default with a "show details" toggle
     - System message hidden behind "show system prompt" toggle
     - Text input + Send button at the bottom
     - Polls `/messages` every 1s while open
7. **End-to-end test:**
   - Create a `deepseek-coord` agent (openapicoor) via the UI with the user-provided DeepSeek key
   - Test Connection passes
   - Assign it a task → it picks up, posts streaming comments via tool calls
   - Open the chat modal, send "Why this approach?", verify the bot replies
   - Enable heartbeat at 60s interval, verify it fires automatically and scans the project
   - Try to enable heartbeat on a second bot, verify 409 Conflict
   - Rotate the API key via the Provider Config card, verify the next wake uses the new key
   - Force the message history past 80% of context window, verify compaction kicks in
8. **(Future v2)** Per-project unique partial index for the heartbeat constraint as a hardening pass; SSE for chat updates; cost dashboards.

---

## Decisions Locked In

| # | Decision |
|---|---|
| 1 | New roles `openapidev` and `openapicoor`, each with its own skill file. Role implies provider — no separate `provider` column. |
| 2 | v1 tool set: 8 listed + `read_memory_file` (9 total). |
| 3 | First provider to test against: **DeepSeek or Kimi (Moonshot)**. User provides the key. |
| 4 | API key stored **directly in DB** (`provider_api_key` column). Mitigated by `redactActor()` helper, never returned to frontend after create, manual rotation. |
| 5 | Context overflow → **compact**: keep system + summarize middle + keep last K rounds. 80% threshold, K = 6 rounds. |
| 6 | Persistence: end of wake event only. |
| 7 | **Streaming progress comments KEEP** — same UX as Claude. `🔄 Working...` at start, deltas every 10s, brief `🛠 calling toolname...` notes for tool rounds, final comment at end. Use `stream: true` on the OpenAI request. |
| 8 | Tool round budget: **50** per wake event. |
| 9 | Bot can wake other agents via `assign_task` and `@mention` in `post_comment`. The whole point. |
| 10 | UI badges: icon-based (🤖 Claude, 🌐 OpenAI). |
| 11 | Conversation modal is **interactive** — chat send is a v1 feature, not v2. Polling-based updates. |
| 12 | List endpoints **strip** `message_history`; dedicated `/messages` endpoint for the chat modal. |
| 13 | **Heartbeat** is opt-in per-actor, config'd via UI, **only ONE actor in the system** can have heartbeat enabled at a time (409 Conflict on violation). |
| 14 | Heartbeat **fans out one wake event per active project** the bot has a session in. Bootstrap by assigning a task once. Minimum interval 30s. |
| 15 | Provider config (base_url / model / api_key) is editable post-creation via dedicated `PATCH /actors/:id/provider-config` endpoint. API key is write-only and never returned. |

---

## What's NOT in scope (v1)

- **Multi-provider load balancing** (e.g. fall back to Groq if DeepSeek 429s).
- **Cost dashboards.** Token counts tracked, dollar cost not.
- **More than one heartbeat-enabled bot** at a time. Hard constraint.
- **Heartbeat firing for projects where the bot has no session.** Bootstrap requires a one-time manual assignment.
- **Tool calls that touch project files.** No filesystem, shell, or git.
- **Bot creating tasks** (`create_task` tool). v2.
- **Bot writing memory files.** Read-only.
- **SSE for chat updates.** Polling for v1.
- **`ai_provider` table** for shared provider configs. Per-actor only.
- **API key rotation UX** beyond "re-enter the key". No partial reveal, no last-N-chars display.
- **Conversation export / import.**
- **Database-level enforcement of single-heartbeat constraint.** Service-level only in v1; partial unique index is v2 hardening.

---

## Open Questions (still)

- **K (last messages kept verbatim during compaction)** — I picked 6 rounds. Tunable. Worth measuring once we see real conversation patterns.
- **Compaction trigger threshold** — I picked 80% of context window. Tunable.
- **Should the chat modal show the system message at the top, or hide it behind a "show system prompt" toggle?** My pick: hide by default, toggle to show. Skill files are long.
- **Should chat messages from humans count toward the bot's "wake" stats** (last_active_at, etc.)? My pick: yes, treat them identically to assignment-triggered wakes.
- **Polling rate for the chat modal** — 1s feels right for v1. Could go to 500ms if it feels laggy, or 2s if it's wasteful.
- **Should we let the human pick the model on a per-chat basis?** No — model is per-actor. To use a different model, create a different agent.

---

## Composition with per-project sessions

This roadmap lives on top of [per-project-sessions.md](./per-project-sessions.md), which is shipped. Specifically:

- The `message_history` column is added to the **same** `agent_project_session` table — one row per `(agent, project)` regardless of role/provider
- Cascade-delete from project or actor still cleans up Claude session_ids and OpenAI message histories together
- The runner's `findOrCreate(agent_id, project_id)` flow is unchanged — only the spawn step branches

If you create both a Claude `developer` and a `openapidev` for the same project, they each get their own row with their own conversation state. They don't see each other's history.
