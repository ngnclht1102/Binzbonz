import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { Actor, WakeEvent } from './types.js';
import { getTask, getTaskComments, getProject, getChangedMemoryFiles, getActors } from './api-client.js';
import { loadBinzbonzConfig, resolveBranchName, DEFAULT_CONFIG } from './binzbonz-config.js';
import { log, warn, debug } from './logger.js';

// Resolve project root: walk up from CWD until we find 'skills/' dir
function findProjectRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (existsSync(resolve(dir, 'skills', 'master.md'))) return dir;
    dir = resolve(dir, '..');
  }
  return process.cwd();
}

function loadSkillFile(role: string | null): string {
  const root = process.env.BINZBONZ_ROOT ?? findProjectRoot();
  const fileName =
    role === 'master' ? 'master.md'
    : role === 'openapidev' ? 'openapidev.md'
    : role === 'openapicoor' ? 'openapicoor.md'
    : 'developer.md';
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

/** Per-project session state, passed in by the runner. */
export interface SessionState {
  session_id: string | null;
  last_token_count: number;
  last_active_at: string | null;
}

/**
 * Build the context that's common to both new and resumed sessions:
 * project info, task info, recent comments, memory changes, trigger instructions.
 */
async function buildContext(
  event: WakeEvent,
  actor: Actor,
  sessionState: SessionState,
): Promise<string> {
  const parts: string[] = [];

  if (sessionState.last_token_count > 900_000) {
    parts.push(
      '[CONTEXT WARNING: You are at 900k+ tokens. After processing this message, run /compact to reduce context size.]',
    );
  }

  // Project context + per-project config (binzbonz.md overrides)
  let config = { ...DEFAULT_CONFIG };
  let repoPath: string | null = null;
  try {
    const project = await getProject(event.project_id);
    repoPath = project.repo_path ?? null;
    config = loadBinzbonzConfig(repoPath);
    parts.push(`## Project: ${project.name}`);
    if (project.brief) parts.push(`Brief: ${project.brief}`);
    parts.push(`Project status: ${project.status}`);
  } catch {
    parts.push(`Project ID: ${event.project_id}`);
  }

  parts.push('');
  parts.push('## Project configuration (from binzbonz.md — overrides your skill defaults)');
  parts.push(`- Integration branch: \`${config.default_branch}\``);
  parts.push(
    `  → This is the branch to merge/target against. Wherever your skill file says "main", use \`${config.default_branch}\` instead.`,
  );
  parts.push(
    `- Peer review required: ${
      config.need_review_by_other_dev ? 'YES' : 'NO'
    }`,
  );
  parts.push(
    `- Auto-merge to \`${config.default_branch}\` after done: ${
      config.auto_merge ? 'YES' : 'NO — human reviews + merges'
    }`,
  );
  if (config.need_review_by_other_dev) {
    parts.push(
      '  → After self-review + green tests, call `list_idle_developers`, pick the LAST entry, set task status to `review_request`, and post a comment @mentioning them. Do NOT mark the task `done` yourself.',
    );
  }
  if (!config.auto_merge) {
    parts.push(
      `  → When work is complete and tests pass, do NOT run \`git merge\` or \`git push\` to \`${config.default_branch}\`. Push your task branch to origin, set task status to \`review_request\`, post a comment with the exact branch name you pushed so a human can review and merge it, and stop.`,
    );
  }

  // Task context
  if (event.task_id) {
    try {
      const task = await getTask(event.task_id);
      parts.push('');
      parts.push(`## Task: ${task.title} (task_id: ${task.id})`);
      parts.push(`Status: ${task.status}`);
      if (task.description) parts.push(`Description: ${task.description}`);
      // Resolved branch name from the project's configured template —
      // agent should use this exact string, no placeholders to interpret.
      const branchName = resolveBranchName(config.task_branch_template, {
        id: task.id,
        title: task.title,
      });
      parts.push(`Branch name to use: \`${branchName}\``);

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

  // Actor roster — list every actor in the system, separated into agents
  // (which the bot may @mention to wake up) and humans (which the bot must
  // NEVER @mention). Without this the bot can't tell brian apart from dev-1
  // — both are just strings to it.
  try {
    const actors = await getActors();
    const agents = actors.filter((a) => a.type === 'agent' && a.id !== actor.id);
    const humans = actors.filter((a) => a.type === 'human');
    parts.push('');
    parts.push('## Actor roster (KEY: only @mention agents, NEVER humans)');
    if (agents.length > 0) {
      parts.push('Agents you may @mention to wake them:');
      for (const a of agents) {
        parts.push(`  - @${a.name} (role: ${a.role}, status: ${a.status})`);
      }
    }
    if (humans.length > 0) {
      parts.push('Humans (NEVER @mention these — they read the UI directly):');
      for (const h of humans) {
        parts.push(`  - ${h.name}`);
      }
    }
  } catch {
    // ignore — fall through without the roster
  }

  // Memory changes (only for resumed sessions)
  if (sessionState.last_active_at) {
    try {
      const changedFiles = await getChangedMemoryFiles(
        event.project_id,
        sessionState.last_active_at,
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
    parts.push(
      'This is a scheduled HEARTBEAT scan of THIS PROJECT. You were not assigned to a task — you are proactively checking on the project.\n\n' +
        'Your job: scan existing tasks and push forward ONLY things that genuinely need action. If nothing needs action, DO NOTHING and exit with a one-line summary. Do not invent work. Do not push anyone to create new work. Do not ping master to make new tickets.\n\n' +
        '🚨 CRITICAL @MENTION RULE 🚨\n' +
        'NEVER @mention a human (see the Actor roster section above). Humans read the UI directly.\n' +
        'ONLY @mention AGENTS. To find the right agent for a task, call `get_task` first and read the `assigned_agent` field. Do NOT guess the assignee from comment authors.\n' +
        'If a task has NO assignee (assigned_agent is null) AND it is in `backlog` with clear acceptance criteria, call `list_idle_developers` and `assign_task`. Otherwise leave it alone.\n\n' +
        'Scan checklist:\n' +
        '  1. Call `list_project_tasks`. If the project has zero tasks, or only has tasks in `done`/`cancelled`, do nothing and return a one-line summary like `0 active tasks, nothing to coordinate`. Do NOT ping master to create work.\n' +
        '  2. For each task in `assigned` or `in_progress`: call `get_task` and `get_task_comments`. If `assigned_agent` is an AGENT and the task has been silent for hours, post `@<agent_name> any progress on this?`. Skip if activity was in the last 30 minutes.\n' +
        '  3. For each task in `blocked`: read the most recent comment. If the blocker looks resolved or is waiting on a specific AGENT, ping that agent. Otherwise leave it — humans will unblock it.\n' +
        '  4. For each task in `backlog` with clear acceptance criteria: call `list_idle_developers`, pick one, call `assign_task`. If criteria are unclear, leave it — humans will clarify.\n' +
        '  5. For each task in `review_request` without a reviewer: assign a different idle developer.\n\n' +
        '"Nothing to do" is a valid outcome. Return a one-line summary specifying what you scanned (e.g. `Scanned 4 tasks: 2 done, 2 in_progress with recent activity. Nothing stuck.`). Do NOT fabricate work to look busy.',
    );
  } else if (event.triggered_by === 'chat') {
    // Chat messages are appended directly to history before this builder
    // runs. The trigger flow doesn't add a new user message — the OpenAI
    // spawner sees the user content already in history. This branch is
    // never used for the chat flow but is kept for safety.
    parts.push('A human posted a chat message. Respond briefly via your tools.');
  } else {
    parts.push('Check your current task and continue working.');
  }

  return parts.join('\n');
}

export async function buildPrompt(
  event: WakeEvent,
  actor: Actor,
  sessionState: SessionState,
): Promise<{ prompt: string; isNewSession: boolean }> {
  // Token-based compaction
  if (sessionState.last_token_count > 960_000) {
    return { prompt: '/compact', isNewSession: false };
  }

  const context = await buildContext(event, actor, sessionState);

  // NEW SESSION: no session_id → load skill file + full identity + context
  if (!sessionState.session_id) {
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

/**
 * Build the system message for an OpenAI-compatible agent. Loads the role's
 * skill file, prepends identity (name, actor_id, project_id, available
 * tools reminder). Sent ONCE per (agent, project) on the first wake.
 */
export function buildOpenAISystemMessage(actor: Actor, projectId: string): string {
  const skill = loadSkillFile(actor.role);
  const parts: string[] = [];

  if (skill) {
    parts.push(skill);
    parts.push('');
    parts.push('---');
    parts.push('');
  }

  parts.push(`You are "${actor.name}" (role: ${actor.role}).`);
  parts.push(`Your actor_id is \`${actor.id}\`.`);
  parts.push(`Your current project_id is \`${projectId}\`.`);
  parts.push('');

  // openapidev has the full developer tool surface — real filesystem and
  // shell — so the "no shell, no filesystem" boilerplate would be a lie.
  // Coordinators (openapicoor) still get the read-only framing.
  if (actor.role === 'openapidev') {
    parts.push(
      'You can take action through the function-calling tools provided to you. ' +
        'These include read_file, write_file, list_files, and run_shell — real ' +
        'filesystem and shell access scoped to the project workspace. Use them ' +
        'to actually implement tasks: edit code, run tests, commit, merge. ' +
        'Every wake event is scoped to ONE project — stay in this project. ' +
        'Be terse in your comments. Take action, then return a brief one-line text response.',
    );
  } else {
    parts.push(
      'You can ONLY take action through the function-calling tools provided to you. ' +
        'You have no shell, no filesystem, no git, no curl. ' +
        'Every wake event is scoped to ONE project — stay in this project. ' +
        'Be terse in your comments. Take action, then return a brief one-line text response.',
    );
  }

  return parts.join('\n');
}

/**
 * Build the user message for an OpenAI-compatible agent on each wake.
 * This is the same task/project context as the Claude flow, just returned
 * as a plain string ready to be wrapped in `{ role: 'user', content }`.
 */
export async function buildOpenAIUserMessage(
  event: WakeEvent,
  actor: Actor,
  sessionState: SessionState,
): Promise<string> {
  return buildContext(event, actor, sessionState);
}
