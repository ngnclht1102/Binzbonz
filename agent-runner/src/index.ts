import {
  getPendingEvents,
  getActor,
  getProject,
  updateWakeEvent,
  updateActor,
  postComment,
} from './api-client.js';
import { buildPrompt } from './prompt-builder.js';
import { spawnClaude } from './claude-spawner.js';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const POLL_INTERVAL = 2000;
const STREAM_FLUSH_MS = 2000; // Post accumulated text every 2s

let processing = false;

console.log(`agent-runner started (API: ${API_URL})`);
console.log('Polling for wake events (1 at a time)...');

async function processEvent(eventId: string): Promise<void> {
  const event = await updateWakeEvent(eventId, 'processing');

  try {
    const actor = await getActor(event.agent_id);
    const project = await getProject(event.project_id);

    // Gate check
    if (
      (project.status === 'analysing' || project.status === 'paused') &&
      actor.role !== 'ctbaceo'
    ) {
      console.log(`[runner] Skipping ${actor.name}: project is ${project.status}`);
      await updateWakeEvent(eventId, 'skipped');
      return;
    }

    await updateActor(actor.id, { status: 'working' });

    const { prompt } = await buildPrompt(event, actor);
    const taskId = event.task_id;

    console.log(`[runner] >>> Processing: ${actor.name} (${event.triggered_by})${taskId ? ` on task ${taskId.slice(0, 8)}` : ''}`);

    // Post a "working" indicator comment
    if (taskId) {
      await postComment(taskId, actor.id, '🔄 Agent started working...', 'update').catch(() => {});
    }

    // Stream Claude output — accumulate chunks and post periodically as comments
    let textBuffer = '';
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let commentCount = 0;

    const flushBuffer = async () => {
      if (!textBuffer.trim() || !taskId) return;
      const chunk = textBuffer.trim();
      textBuffer = '';
      commentCount++;
      try {
        await postComment(taskId, actor.id, chunk, 'update');
      } catch {
        // ignore post failures
      }
    };

    const onTextChunk = (text: string) => {
      textBuffer += text;
      // Flush on newlines or every STREAM_FLUSH_MS
      if (text.includes('\n') && textBuffer.length > 50) {
        if (flushTimer) clearTimeout(flushTimer);
        flushTimer = setTimeout(() => { void flushBuffer(); }, 200);
      } else if (!flushTimer) {
        flushTimer = setTimeout(() => {
          flushTimer = null;
          void flushBuffer();
        }, STREAM_FLUSH_MS);
      }
    };

    const result = await spawnClaude(actor, prompt, taskId ? onTextChunk : undefined);

    // Flush any remaining text
    if (flushTimer) clearTimeout(flushTimer);
    if (textBuffer.trim() && taskId) {
      await flushBuffer();
    }

    // If no streaming happened but there's output, post it all
    if (commentCount === 0 && result.textOutput.trim() && taskId) {
      // Split long output into chunks of ~2000 chars
      const text = result.textOutput.trim();
      for (let i = 0; i < text.length; i += 2000) {
        await postComment(taskId, actor.id, text.slice(i, i + 2000), 'update').catch(() => {});
      }
    }

    // If still no output at all, post stderr as debug info
    if (commentCount === 0 && !result.textOutput.trim() && taskId && result.rawStderr.trim()) {
      await postComment(taskId, actor.id, `⚠️ No output captured.\nstderr: ${result.rawStderr.slice(0, 500)}`, 'update').catch(() => {});
    }

    // Post completion marker
    if (taskId) {
      await postComment(taskId, actor.id, '✅ Agent finished.', 'update').catch(() => {});
    }

    console.log(`[runner] Agent ${actor.name} output: ${result.textOutput.length} chars, ${commentCount} streamed comments`);

    // Update actor
    await updateActor(actor.id, {
      session_id: result.sessionId ?? undefined,
      last_token_count: result.inputTokens,
      status: 'idle',
    });

    await updateWakeEvent(eventId, 'done');
    console.log(`[runner] <<< Done: ${actor.name}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[runner] <<< Failed: ${msg}`);

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

  try {
    const events = await getPendingEvents();
    if (events.length === 0) return;

    processing = true;
    const next = events[0];
    console.log(`[runner] Queue: ${events.length} pending, processing 1...`);

    try {
      await processEvent(next.id);
    } finally {
      processing = false;
    }
  } catch (err) {
    processing = false;
    if (err instanceof Error && !err.message.includes('fetch failed')) {
      console.error('[runner] Poll error:', err.message);
    }
  }
}

const interval = setInterval(poll, POLL_INTERVAL);

process.on('SIGINT', () => {
  clearInterval(interval);
  console.log('agent-runner stopped');
  process.exit(0);
});

process.on('SIGTERM', () => {
  clearInterval(interval);
  console.log('agent-runner stopped');
  process.exit(0);
});
