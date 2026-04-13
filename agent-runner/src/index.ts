import {
  getPendingEvents,
  getProcessingEvents,
  getActors,
  getActor,
  getActorWithSecrets,
  getProject,
  getTask,
  updateWakeEvent,
  updateActor,
  postComment,
  getAgentProjectSession,
  getAgentProjectSessionWithMessages,
  upsertAgentProjectSession,
} from './api-client.js';
import {
  buildPrompt,
  buildOpenAISystemMessage,
  buildOpenAIUserMessage,
  type SessionState,
} from './prompt-builder.js';
import { spawnClaude } from './claude-spawner.js';
import { spawnOpenAI } from './openai-spawner.js';
import type { OpenAIMessage, WakeEvent, Actor } from './types.js';
import { log, warn, error as logError } from './logger.js';

const OPENAPI_ROLES = new Set(['openapidev', 'openapicoor']);

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const POLL_INTERVAL = 2000;

let processing = false;
let startupCleanupDone = false;

log('runner',`agent-runner started (API: ${API_URL})`);

async function startupCleanup(): Promise<void> {
  if (startupCleanupDone) return;
  try {
    // Reset stale 'processing' events back to 'pending'
    const staleEvents = await getProcessingEvents();
    for (const e of staleEvents) {
      log("cleanup",` Resetting stale processing event ${e.id} → pending`);
      await updateWakeEvent(e.id, 'pending');
    }

    // Reset stale 'working' actors back to 'idle'
    const actors = await getActors();
    for (const a of actors) {
      if (a.status === 'working') {
        log("cleanup",` Resetting stale working actor ${a.name} → idle`);
        await updateActor(a.id, { status: 'idle' });
      }
    }

    startupCleanupDone = true;
    log('runner', 'Startup cleanup done. Polling for wake events (1 at a time)...');
  } catch {
    // API not ready yet, will retry next poll
  }
}

// Per-spawn helpers — own their own progress buffer + 10s flush timer.
// Both end with upserting the per-project session row and marking the wake
// event done.

interface WakeProject {
  id: string;
  name: string;
  brief: string | null;
  status: string;
  repo_path: string | null;
}

function makeProgressTimer(taskId: string | null, actorId: string) {
  let buffer = '';
  let timer: ReturnType<typeof setInterval> | null = null;
  if (taskId) {
    timer = setInterval(async () => {
      if (buffer.trim().length > 50) {
        const chunk = buffer.trim();
        buffer = '';
        await postComment(taskId, actorId, chunk, 'update').catch(() => {});
      }
    }, 10_000);
  }
  return {
    onChunk: taskId ? (text: string) => { buffer += text; } : undefined,
    flush: async () => {
      if (timer) clearInterval(timer);
      if (buffer.trim() && taskId) {
        await postComment(taskId, actorId, buffer.trim(), 'update').catch(() => {});
      }
    },
  };
}

async function runClaudeWake(
  event: WakeEvent,
  actor: Actor,
  project: WakeProject,
  taskId: string | null,
  eventId: string,
): Promise<void> {
  const sessionRow = await getAgentProjectSession(actor.id, event.project_id);
  const sessionState: SessionState = {
    session_id: sessionRow?.session_id ?? null,
    last_token_count: sessionRow?.last_token_count ?? 0,
    last_active_at: sessionRow?.last_active_at ?? null,
  };

  let { prompt, isNewSession } = await buildPrompt(event, actor, sessionState);
  log("runner",` >>> Processing: ${actor.name} (${event.triggered_by})${taskId ? ` on task ${taskId.slice(0, 8)}` : ''} [${isNewSession ? 'NEW session' : 'RESUME ' + sessionState.session_id?.slice(0, 8)}] prompt=${prompt.length} chars`);

  const { onChunk, flush } = makeProgressTimer(taskId, actor.id);

  let result = await spawnClaude(sessionState.session_id, prompt, project.repo_path ?? undefined, onChunk);

  if (result.fatalError) {
    await flush();
    logError("runner", `Fatal error for ${actor.name}: ${result.fatalError}`);
    if (taskId) {
      await postComment(
        taskId, actor.id,
        `🚫 Agent stopped: ${result.fatalError}\n\nThis is a non-retryable error (quota/rate limit). The task will remain in its current state. Try again later.`,
        'block',
      ).catch(() => {});
    }
    await updateActor(actor.id, { status: 'idle' });
    await updateWakeEvent(eventId, 'failed');
    log("runner", ` <<< Stopped (fatal): ${actor.name}`);
    return;
  }

  // If spawner fell back to a new session, clear our state and rebuild prompt with skill file
  if (result.isNewSession && !isNewSession) {
    log("runner",` Session fallback detected — rebuilding prompt with skill file`);
    sessionState.session_id = null;
    const rebuilt = await buildPrompt(event, actor, sessionState);
    prompt = rebuilt.prompt;
    isNewSession = true;
    result = await spawnClaude(null, prompt, project.repo_path ?? undefined, onChunk);

    if (result.fatalError) {
      await flush();
      logError("runner", `Fatal error for ${actor.name} on new session: ${result.fatalError}`);
      if (taskId) {
        await postComment(taskId, actor.id, `🚫 Agent stopped: ${result.fatalError}`, 'block').catch(() => {});
      }
      await updateActor(actor.id, { status: 'idle' });
      await updateWakeEvent(eventId, 'failed');
      log("runner", ` <<< Stopped (fatal): ${actor.name}`);
      return;
    }
  }

  await flush();

  const output = result.textOutput.trim();
  if (!output && taskId && result.rawStderr.trim()) {
    await postComment(taskId, actor.id, `⚠️ No output captured.\nstderr: ${result.rawStderr.slice(0, 500)}`, 'update').catch(() => {});
  } else if (!output && taskId) {
    await postComment(taskId, actor.id, '⚠️ Agent produced no output.', 'update').catch(() => {});
  }

  log("runner",` Agent ${actor.name} output: ${output.length} chars`);

  await upsertAgentProjectSession(actor.id, event.project_id, {
    session_id: result.sessionId ?? sessionState.session_id ?? null,
    last_token_count: result.inputTokens,
  }).catch((err) => {
    logError("runner", `Failed to upsert session row: ${err instanceof Error ? err.message : String(err)}`);
  });

  await updateActor(actor.id, { status: 'idle' });
  await updateWakeEvent(eventId, 'done');
  log("runner",` <<< Done: ${actor.name}`);
}

async function runOpenAIWake(
  event: WakeEvent,
  actor: Actor,
  project: WakeProject,
  taskId: string | null,
  eventId: string,
): Promise<void> {
  // OpenAI agents need the unredacted API key — fetch the raw row.
  const actorWithSecrets = await getActorWithSecrets(actor.id);
  if (!actorWithSecrets.provider_api_key || !actorWithSecrets.provider_base_url || !actorWithSecrets.provider_model) {
    const msg = `Agent ${actor.name} is missing provider config (base_url / model / api_key)`;
    logError("runner", msg);
    if (taskId) {
      await postComment(taskId, actor.id, `🚫 ${msg}`, 'block').catch(() => {});
    }
    await updateActor(actor.id, { status: 'idle' });
    await updateWakeEvent(eventId, 'failed');
    return;
  }

  // Load full session row INCLUDING message_history.
  const sessionRow = await getAgentProjectSessionWithMessages(actor.id, event.project_id);
  const history = (sessionRow?.message_history ?? []) as OpenAIMessage[];
  const sessionState: SessionState = {
    session_id: null, // unused for OpenAI
    last_token_count: sessionRow?.last_token_count ?? 0,
    last_active_at: sessionRow?.last_active_at ?? null,
  };

  // Build the system message (only used on first wake, when history is empty)
  // and the user message (built fresh every wake from current task context).
  const systemMessage = buildOpenAISystemMessage(actor, event.project_id);

  // For chat triggers, the user message is ALREADY in history (the API
  // append-on-chat endpoint did it). Skip building task context and just
  // run the spawner with what's there.
  let userMessage: string;
  if (event.triggered_by === 'chat') {
    // No new user message — the spawner will see the existing history
    // ending with the human's chat message. Pass an empty string and the
    // spawner will skip pushing it.
    userMessage = '';
  } else {
    userMessage = await buildOpenAIUserMessage(event, actor, sessionState);
  }

  log("runner",` >>> Processing: ${actor.name} (${event.triggered_by})${taskId ? ` on task ${taskId.slice(0, 8)}` : ''} [${history.length === 0 ? 'NEW session' : 'RESUME (' + history.length + ' msgs)'}] provider=${actorWithSecrets.provider_model}`);

  const { onChunk, flush } = makeProgressTimer(taskId, actor.id);
  // Tool note callback — fires once per tool round, posts a brief
  // "🛠 calling X..." comment so the UI shows activity during silent rounds.
  const onToolNote = taskId
    ? (text: string) => {
        postComment(taskId, actor.id, text, 'update').catch(() => {});
      }
    : undefined;

  const result = await spawnOpenAI({
    actor: actorWithSecrets,
    projectId: event.project_id,
    history,
    userMessage,
    systemMessage,
    lastTokenCount: sessionState.last_token_count,
    onTextChunk: onChunk,
    onToolNote,
  });

  await flush();

  if (result.fatalError) {
    logError("runner", `Fatal error for ${actor.name}: ${result.fatalError}`);
    if (taskId) {
      await postComment(taskId, actor.id, `🚫 Agent stopped: ${result.fatalError}`, 'block').catch(() => {});
    }
    // Persist whatever history we have so we don't lose progress
    await upsertAgentProjectSession(actor.id, event.project_id, {
      message_history: result.messageHistory,
      last_token_count: result.inputTokens,
    }).catch(() => {});
    await updateActor(actor.id, { status: 'idle' });
    await updateWakeEvent(eventId, 'failed');
    return;
  }

  const output = result.textOutput.trim();
  if (output && taskId) {
    await postComment(taskId, actor.id, output, 'update').catch(() => {});
  } else if (!output && taskId) {
    await postComment(taskId, actor.id, '⚠️ Agent produced no text response.', 'update').catch(() => {});
  }

  log("runner",` Agent ${actor.name} output: ${output.length} chars, ${result.messageHistory.length} msgs total`);

  await upsertAgentProjectSession(actor.id, event.project_id, {
    message_history: result.messageHistory,
    last_token_count: result.inputTokens,
  }).catch((err) => {
    logError("runner", `Failed to upsert session row: ${err instanceof Error ? err.message : String(err)}`);
  });

  await updateActor(actor.id, { status: 'idle' });
  await updateWakeEvent(eventId, 'done');
  log("runner",` <<< Done: ${actor.name}`);
}

async function processEvent(eventId: string): Promise<void> {
  const event = await updateWakeEvent(eventId, 'processing');

  try {
    const actor = await getActor(event.agent_id);
    const project = await getProject(event.project_id);

    // Gate check: project status.
    // In `analysing` / `paused`, only ctbaceo may work — every other agent
    // (developers and openapi* coordinators) is paused until the project
    // moves to `active`.
    if (
      (project.status === 'analysing' || project.status === 'paused') &&
      actor.role !== 'ctbaceo'
    ) {
      log("runner",` Skipping ${actor.name}: project is ${project.status}`);
      await updateWakeEvent(eventId, 'skipped');
      return;
    }

    // Gate check: task status. Re-fetch the task immediately before spawning
    // and bail if it was cancelled or finished while this wake was queued.
    // Closes the race where the user cancels a task while a wake event for
    // it is sitting in the pending queue (or just got picked up).
    const taskId = event.task_id;
    if (taskId) {
      try {
        const task = await getTask(taskId);
        if (task.status === 'cancelled' || task.status === 'done') {
          log(
            'runner',
            ` Skipping ${actor.name}: task ${taskId.slice(0, 8)} is ${task.status}`,
          );
          await updateWakeEvent(eventId, 'skipped');
          return;
        }
      } catch {
        // If we can't fetch the task, fall through and let the agent handle it.
      }
    }

    await updateActor(actor.id, { status: 'working' });

    if (taskId) {
      // Common "working" indicator
      await postComment(taskId, actor.id, '🔄 Working...', 'update').catch(() => {});
    }

    if (OPENAPI_ROLES.has(actor.role ?? '')) {
      await runOpenAIWake(event, actor, project, taskId, eventId);
    } else {
      await runClaudeWake(event, actor, project, taskId, eventId);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError("runner",` <<< Failed: ${msg}`);

    // Post failure notice on task
    if (event.task_id) {
      await postComment(event.task_id, event.agent_id, `❌ Agent failed: ${msg}`, 'block').catch(() => {});
    }

    await updateWakeEvent(eventId, 'failed').catch(() => {});
    try {
      await updateActor(event.agent_id, { status: 'idle' });
    } catch {
      // ignore
    }
  }
}

async function poll(): Promise<void> {
  if (processing) return;

  // Run startup cleanup on first successful poll
  if (!startupCleanupDone) {
    await startupCleanup();
    return;
  }

  try {
    const events = await getPendingEvents();
    if (events.length === 0) return;

    processing = true;
    const next = events[0];
    log("runner",` Queue: ${events.length} pending, processing 1...`);

    try {
      await processEvent(next.id);
    } finally {
      processing = false;
    }
  } catch (err) {
    processing = false;
    if (err instanceof Error && !err.message.includes('fetch failed')) {
      logError('runner', `Poll error: ${err.message}`);
    }
  }
}

const interval = setInterval(poll, POLL_INTERVAL);

process.on('SIGINT', () => {
  clearInterval(interval);
  log('runner','agent-runner stopped');
  process.exit(0);
});

process.on('SIGTERM', () => {
  clearInterval(interval);
  log('runner','agent-runner stopped');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  logError('runner', `Uncaught exception: ${err.message}`);
  logError('runner', err.stack ?? '');
  clearInterval(interval);
  process.exit(1); // Watchdog will restart
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  logError('runner', `Unhandled rejection: ${msg}`);
  clearInterval(interval);
  process.exit(1); // Watchdog will restart
});
