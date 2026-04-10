import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { Actor, WakeEvent } from './types.js';
import { getTask, getTaskComments, getProject, getChangedMemoryFiles } from './api-client.js';
import { log, warn, debug } from './logger.js';

// Resolve project root: walk up from CWD until we find 'skills/' dir
function findProjectRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (existsSync(resolve(dir, 'skills', 'ctbaceo.md'))) return dir;
    dir = resolve(dir, '..');
  }
  return process.cwd();
}

function loadSkillFile(role: string | null): string {
  const root = process.env.BINZBONZ_ROOT ?? findProjectRoot();
  const fileName = role === 'ctbaceo' ? 'ctbaceo.md' : 'developer.md';
  const filePath = resolve(root, 'skills', fileName);
  try {
    const content = readFileSync(filePath, 'utf-8');
    log("prompt",` Loaded skill: ${filePath} (${content.length} bytes)`);
    return content;
  } catch {
    warn("prompt",` Skill file not found: ${filePath}`);
    return '';
  }
}

/**
 * Build the context that's common to both new and resumed sessions:
 * project info, task info, recent comments, memory changes, trigger instructions.
 */
async function buildContext(event: WakeEvent, actor: Actor): Promise<string> {
  const parts: string[] = [];

  if (actor.last_token_count > 900_000) {
    parts.push(
      '[CONTEXT WARNING: You are at 900k+ tokens. After processing this message, run /compact to reduce context size.]',
    );
  }

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
      parts.push(`## Task: ${task.title} (task_id: ${task.id})`);
      parts.push(`Status: ${task.status}`);
      if (task.description) parts.push(`Description: ${task.description}`);

      // Recent comments
      const comments = await getTaskComments(event.task_id);
      if (comments.length > 0) {
        parts.push('');
        parts.push('## Recent comments:');
        const recent = comments.slice(-10);
        for (const c of recent) {
          parts.push(`- [${c.comment_type}] ${c.body}`);
        }
      }
    } catch {
      parts.push(`Task ID: ${event.task_id}`);
    }
  }

  // Memory changes (only for resumed sessions)
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
    parts.push('You have been assigned to this task. Read the task description and start working on it. Post your plan and progress as comments via the API.');
  } else if (event.triggered_by === 'mention') {
    parts.push('You were @mentioned in a comment. Read the comments above and respond or take action accordingly via the API.');
  } else if (event.triggered_by === 'heartbeat') {
    parts.push('This is a heartbeat check. Review all active tasks, check for stuck agents, and coordinate as needed.');
  } else {
    parts.push('Check your current task and continue working.');
  }

  return parts.join('\n');
}

export async function buildPrompt(
  event: WakeEvent,
  actor: Actor,
): Promise<{ prompt: string; isNewSession: boolean }> {
  // Token-based compaction
  if (actor.last_token_count > 960_000) {
    return { prompt: '/compact', isNewSession: false };
  }

  const context = await buildContext(event, actor);

  // NEW SESSION: no session_id → load skill file + full identity + context
  if (!actor.session_id) {
    const sections: string[] = [];

    const skill = loadSkillFile(actor.role);
    if (skill) {
      sections.push('skill-file');
    }

    const parts: string[] = [];
    if (skill) {
      parts.push(skill);
      parts.push('');
      parts.push('---');
      parts.push('');
    }

    sections.push('identity', 'context');
    parts.push(`You are "${actor.name}" (role: ${actor.role}), actor_id: \`${actor.id}\`.`);
    parts.push(`Your project_id is \`${event.project_id}\`.`);
    parts.push('Remember your actor_id and project_id — you need them for all API calls.');
    parts.push('');
    parts.push(context);

    const prompt = parts.join('\n');
    log("prompt",` NEW session for ${actor.name}: sections=[${sections.join(',')}] length=${prompt.length} chars`);
    return { prompt, isNewSession: true };
  }

  // RESUMED SESSION: has session_id → just send the new context (agent already has skill in memory)
  log("prompt",` RESUME session for ${actor.name}: sections=[context] length=${context.length} chars`);
  return { prompt: context, isNewSession: false };
}
