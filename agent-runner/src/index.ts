import {
  getPendingEvents,
  getProcessingEvents,
  getActors,
  getActor,
  getProject,
  updateWakeEvent,
  updateActor,
  postComment,
  getAgentProjectSession,
  upsertAgentProjectSession,
} from './api-client.js';
import { buildPrompt, type SessionState } from './prompt-builder.js';
import { spawnClaude } from './claude-spawner.js';
import { log, warn, error as logError } from './logger.js';

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

async function processEvent(eventId: string): Promise<void> {
  const event = await updateWakeEvent(eventId, 'processing');

  try {
    const actor = await getActor(event.agent_id);
    const project = await getProject(event.project_id);

    // Gate check: project status
    if (
      (project.status === 'analysing' || project.status === 'paused') &&
      actor.role !== 'ctbaceo'
    ) {
      log("runner",` Skipping ${actor.name}: project is ${project.status}`);
      await updateWakeEvent(eventId, 'skipped');
      return;
    }

    await updateActor(actor.id, { status: 'working' });

    // Per-project session lookup. Defaults to a clean SessionState if no row
    // exists yet — the upsert after the spawn will create the row.
    const sessionRow = await getAgentProjectSession(actor.id, event.project_id);
    const sessionState: SessionState = {
      session_id: sessionRow?.session_id ?? null,
      last_token_count: sessionRow?.last_token_count ?? 0,
      last_active_at: sessionRow?.last_active_at ?? null,
    };

    let { prompt, isNewSession } = await buildPrompt(event, actor, sessionState);
    const taskId = event.task_id;

    log("runner",` >>> Processing: ${actor.name} (${event.triggered_by})${taskId ? ` on task ${taskId.slice(0, 8)}` : ''} [${isNewSession ? 'NEW session' : 'RESUME ' + sessionState.session_id?.slice(0, 8)}] prompt=${prompt.length} chars`);

    // Post "working" indicator immediately so UI shows activity
    if (taskId) {
      await postComment(taskId, actor.id, '🔄 Working...', 'update').catch(() => {});
    }

    // Periodic progress updates — post accumulated text every 10s
    let progressBuffer = '';
    let progressTimer: ReturnType<typeof setInterval> | null = null;
    if (taskId) {
      progressTimer = setInterval(async () => {
        if (progressBuffer.trim().length > 50) {
          const chunk = progressBuffer.trim();
          progressBuffer = '';
          await postComment(taskId, actor.id, chunk, 'update').catch(() => {});
        }
      }, 10_000);
    }

    const onChunk = taskId ? (text: string) => { progressBuffer += text; } : undefined;

    // Run Claude
    let result = await spawnClaude(sessionState.session_id, prompt, project.repo_path ?? undefined, onChunk);

    // Stop progress timer
    if (progressTimer) clearInterval(progressTimer);

    // FATAL ERROR (quota/rate limit) — comment and stop, don't retry or create new session
    if (result.fatalError) {
      logError("runner", `Fatal error for ${actor.name}: ${result.fatalError}`);
      if (taskId) {
        await postComment(
          taskId, actor.id,
          `🚫 Agent stopped: ${result.fatalError}\n\nThis is a non-retryable error (quota/rate limit). The task will remain in its current state. Try again later.`,
          'block',
        ).catch(() => {});
      }
      // Keep the per-project session_id — it's still valid, just can't use it right now
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

      // Check fatal again after retry
      if (result.fatalError) {
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

    // Post any remaining buffered text
    if (progressBuffer.trim() && taskId) {
      await postComment(taskId, actor.id, progressBuffer.trim(), 'update').catch(() => {});
    }

    const output = result.textOutput.trim();
    if (!output && taskId && result.rawStderr.trim()) {
      await postComment(taskId, actor.id, `⚠️ No output captured.\nstderr: ${result.rawStderr.slice(0, 500)}`, 'update').catch(() => {});
    } else if (!output && taskId) {
      await postComment(taskId, actor.id, '⚠️ Agent produced no output.', 'update').catch(() => {});
    }

    log("runner",` Agent ${actor.name} output: ${output.length} chars`);

    // Write back to the per-project session row — bumps last_active_at and stores
    // the session_id (whether reused or freshly created) plus current token count.
    await upsertAgentProjectSession(actor.id, event.project_id, {
      session_id: result.sessionId ?? sessionState.session_id ?? null,
      last_token_count: result.inputTokens,
    }).catch((err) => {
      logError("runner", `Failed to upsert session row: ${err instanceof Error ? err.message : String(err)}`);
    });

    await updateActor(actor.id, { status: 'idle' });

    await updateWakeEvent(eventId, 'done');
    log("runner",` <<< Done: ${actor.name}`);
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
