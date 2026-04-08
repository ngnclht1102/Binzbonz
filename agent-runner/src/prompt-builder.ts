import type { Actor, WakeEvent } from './types.js';
import { getTask, getTaskComments, getProject, getChangedMemoryFiles } from './api-client.js';

export async function buildPrompt(
  event: WakeEvent,
  actor: Actor,
): Promise<{ prompt: string; shouldCompact: boolean }> {
  // Token-based compaction
  if (actor.last_token_count > 960_000) {
    return { prompt: '/compact', shouldCompact: true };
  }

  const parts: string[] = [];

  if (actor.last_token_count > 900_000) {
    parts.push(
      '[CONTEXT WARNING: You are at 900k+ tokens. After processing this message, run /compact to reduce context size.]',
    );
  }

  // Agent identity
  parts.push(`You are "${actor.name}" (role: ${actor.role}).`);

  // Project context
  try {
    const project = await getProject(event.project_id);
    parts.push(`## Project: ${project.name}`);
    if (project.brief) parts.push(`Brief: ${project.brief}`);
    parts.push(`Project status: ${project.status}`);
  } catch {
    parts.push(`Project ID: ${event.project_id}`);
  }

  // Task context
  if (event.task_id) {
    try {
      const task = await getTask(event.task_id);
      parts.push('');
      parts.push(`## Task: ${task.title}`);
      parts.push(`Status: ${task.status}`);
      if (task.description) parts.push(`Description: ${task.description}`);

      // Recent comments on the task
      const comments = await getTaskComments(event.task_id);
      if (comments.length > 0) {
        parts.push('');
        parts.push('## Recent comments:');
        // Show last 10 comments
        const recent = comments.slice(-10);
        for (const c of recent) {
          const actorName = c.actor_id; // We only have the ID here
          parts.push(`- [${c.comment_type}] ${c.body}`);
        }
      }
    } catch {
      parts.push(`Task ID: ${event.task_id}`);
    }
  }

  // Memory changes
  if (actor.last_active_at) {
    try {
      const changedFiles = await getChangedMemoryFiles(
        event.project_id,
        actor.last_active_at,
      );
      if (changedFiles.length > 0) {
        parts.push('');
        parts.push('## Memory files changed since your last activity:');
        for (const f of changedFiles) {
          parts.push(`- ${f.file_path}`);
        }
      }
    } catch {
      // ignore
    }
  }

  // Instructions based on trigger
  parts.push('');
  if (event.triggered_by === 'assignment') {
    parts.push('You have been assigned to this task. Read the task description and start working on it. Post your plan and progress as comments.');
  } else if (event.triggered_by === 'mention') {
    parts.push('You were @mentioned in a comment. Read the comments above and respond or take action accordingly.');
  } else if (event.triggered_by === 'heartbeat') {
    parts.push('This is a heartbeat check. Review all active tasks, check for stuck agents, and coordinate as needed.');
  } else {
    parts.push('Check your current task and continue working.');
  }

  return { prompt: parts.join('\n'), shouldCompact: false };
}
