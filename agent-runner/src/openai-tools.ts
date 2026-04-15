/**
 * OpenAI function-calling tools exposed to openapidev / openapicoor agents.
 *
 * Each tool is a JSON schema (sent to the model) plus an executor that
 * proxies to the Binzbonz HTTP API or the local filesystem/shell.
 *
 * Tools are scoped by role (see `getToolDefinitions` at the bottom):
 *   - openapicoor gets the coordinator set (task/comment/assignment only).
 *   - openapidev gets coordinator tools PLUS developer tools (read_file,
 *     write_file, list_files, run_shell) so it can actually write code.
 *
 * Developer tools are sandboxed to the project's `repo_path` — attempts to
 * escape via "../" or absolute paths are rejected up-front.
 */

import { execa } from 'execa';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'path';
import type { Actor } from './types.js';
import {
  getActorTasks,
  getProjectTasks,
  getTask,
  getTaskComments,
  postComment,
  updateTask,
  listIdleDevelopers,
  readProjectFile,
  postProjectComment,
  getProjectComments,
  getProject,
} from './api-client.js';
import { log, warn } from './logger.js';

// ─── Developer-tool limits ──────────────────────────────────────────────

const MAX_READ_BYTES = 256 * 1024;        // 256KB per read_file
const MAX_WRITE_BYTES = 512 * 1024;       // 512KB per write_file
const MAX_SHELL_OUTPUT_BYTES = 64 * 1024; // 64KB captured per stream
const DEFAULT_SHELL_TIMEOUT_MS = 120_000;
const MAX_SHELL_TIMEOUT_MS = 300_000;
const MAX_DIR_ENTRIES = 500;

// ─── Tool schemas (sent to the model verbatim) ──────────────────────────

/**
 * Coordinator tools — available to every openapi* role. Task/comment/
 * assignment flows only, no filesystem or shell.
 */
const COORDINATOR_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'list_my_tasks',
      description:
        'List every task currently assigned to you across all your projects. ' +
        'Returns task ID, title, status, project ID. Use this to remember what you are working on.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_task',
      description:
        'Get full details of one task: title, description, status, assigned_agent, priority. ' +
        'Use task IDs from list_my_tasks or list_project_tasks — never invent IDs.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'UUID of the task' },
        },
        required: ['task_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_task_comments',
      description:
        'Get recent comments on a task (newest last). Each has actor name, comment_type, body, and timestamp.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'UUID of the task' },
        },
        required: ['task_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'post_comment',
      description:
        'Post a comment on a task. Use @agent-name in the body to wake an agent ' +
        '(only when assignment alone won\'t work). Keep comments terse — one short paragraph max.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'UUID of the task' },
          body: { type: 'string', description: 'The comment text' },
          comment_type: {
            type: 'string',
            description:
              'One of: update, block, question, handoff, memory_update. Defaults to update.',
            enum: ['update', 'block', 'question', 'handoff', 'memory_update'],
          },
        },
        required: ['task_id', 'body'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_task_status',
      description:
        'Move a task between statuses. Valid: backlog, assigned, in_progress, blocked, review_request, done, cancelled. ' +
        'The system enforces valid transitions — if you try an invalid one you will get an error.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'UUID of the task' },
          status: {
            type: 'string',
            enum: ['backlog', 'assigned', 'in_progress', 'blocked', 'review_request', 'done', 'cancelled'],
          },
        },
        required: ['task_id', 'status'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'assign_task',
      description:
        'Assign a task to a developer. Pass null as assigned_agent_id to unassign. ' +
        'IMPORTANT: this wakes the developer automatically — do NOT also @mention them in a comment.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'UUID of the task' },
          assigned_agent_id: {
            type: ['string', 'null'],
            description: 'UUID of the developer agent, or null to unassign',
          },
        },
        required: ['task_id', 'assigned_agent_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_idle_developers',
      description:
        'List every developer agent currently in `idle` status. ' +
        'Use before assigning to pick a free dev. Returns id, name, role.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_project_tasks',
      description:
        'List every task in the current project (the project this wake event was scoped to). ' +
        'Returns task IDs, titles, statuses, assigned agents.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_memory_file',
      description:
        'Read a file from the project workspace, typically from the memory/ directory ' +
        '(shared project context). Path is relative to the project root.',
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Path relative to project root, e.g. "memory/architecture.md"',
          },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_project',
      description:
        'Get the current project — name, brief, status, repo_path. Use this ' +
        'when you need to understand what the project is about, especially ' +
        'when writing the project brief into a @master ping.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_project_comments',
      description:
        'Read project-level comments (not task comments). Use this before ' +
        'posting a project-level comment to see if you or someone else has ' +
        'already pinged master recently — do not duplicate pings.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'post_project_comment',
      description:
        'Post a comment on the PROJECT itself (not on a task). Use this ' +
        'when there are no tasks yet and you need to @mention master to ' +
        'ask them to break down the project brief into a task hierarchy. ' +
        '@mentions in the body still wake the mentioned agent. Be terse.',
      parameters: {
        type: 'object',
        properties: {
          body: { type: 'string', description: 'The comment text' },
          comment_type: {
            type: 'string',
            enum: ['update', 'block', 'question', 'handoff', 'memory_update'],
            description: 'Defaults to update',
          },
        },
        required: ['body'],
      },
    },
  },
];

/**
 * Developer tools — only exposed to openapidev. These give the agent real
 * code-writing capability: read/write files in the project workspace and
 * run shell commands (pnpm test, git, tsc, etc.) from the repo root.
 *
 * All filesystem access is sandboxed to the project's `repo_path`. Paths
 * containing `..` or absolute paths are rejected before they reach fs.
 */
const DEVELOPER_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description:
        'Read any file in the project workspace. Path is relative to the ' +
        'project root. Returns up to 256KB; larger files are truncated and ' +
        'flagged. Use this when you need to inspect code before editing.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path relative to project root, e.g. "apps/api/src/main.ts"',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'write_file',
      description:
        'Write (create or overwrite) a file in the project workspace. Path ' +
        'is relative to the project root. Parent directories are created ' +
        'as needed. The write is atomic (tmp + rename). Max 512KB per call. ' +
        'Use this for all code changes — do NOT try to shell out to sed/awk.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path relative to project root',
          },
          content: {
            type: 'string',
            description: 'Full file contents to write',
          },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_files',
      description:
        'List directory contents in the project workspace. Path defaults ' +
        'to the project root. Returns up to 500 entries with name + type ' +
        '(file / directory). Use this to explore layout before reading.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Directory path relative to project root. Omit for the root.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'run_shell',
      description:
        'Run a shell command from the project root. Use for pnpm test, ' +
        'pnpm lint, git branch/commit/merge, tsc, etc. Captures stdout + ' +
        'stderr (truncated at 64KB each) and exit_code. Default timeout ' +
        '120s, max 300s. Do NOT use this to edit files — use write_file.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The shell command line, e.g. "pnpm test" or "git status"',
          },
          timeout_seconds: {
            type: 'number',
            description: 'Optional timeout in seconds. Default 120, max 300.',
          },
        },
        required: ['command'],
      },
    },
  },
];

export interface ToolContext {
  actor: Actor;
  projectId: string;
  /** Filesystem root for developer tools (sandbox). Null if unresolved. */
  repoPath: string | null;
}

// ─── Developer-tool helpers ─────────────────────────────────────────────

/**
 * Resolve a model-supplied relative path against the project's repo_path.
 * Rejects absolute paths and anything that escapes the root via `..`.
 * Returns a `{ error }` object on failure so executors can return it
 * straight to the model.
 */
function resolveInsideRepo(
  ctx: ToolContext,
  inputPath: string,
): { ok: true; abs: string; rel: string } | { ok: false; error: string } {
  if (!ctx.repoPath) {
    return { ok: false, error: 'project has no repo_path configured' };
  }
  if (!inputPath || typeof inputPath !== 'string') {
    return { ok: false, error: 'path is required' };
  }
  if (isAbsolute(inputPath)) {
    return { ok: false, error: 'path must be relative to the project root' };
  }
  const abs = resolve(ctx.repoPath, inputPath);
  const rel = relative(ctx.repoPath, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return { ok: false, error: 'path escapes the project root' };
  }
  return { ok: true, abs, rel: rel || '.' };
}

function truncate(buf: string, max: number): { text: string; truncated: boolean } {
  if (buf.length <= max) return { text: buf, truncated: false };
  return { text: buf.slice(0, max), truncated: true };
}

/**
 * Execute one tool call. Closes over the actor and project so the model
 * can't escape its scope (we never accept actor_id or project_id as model
 * parameters — they're injected here).
 *
 * Returns a JSON-serializable result. Errors are returned as `{ error: ... }`
 * objects so the model can decide how to react.
 */
export async function executeTool(
  ctx: ToolContext,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  log('tools', `${ctx.actor.name} → ${name}(${JSON.stringify(args).slice(0, 200)})`);
  try {
    switch (name) {
      case 'list_my_tasks':
        return await getActorTasks(ctx.actor.id);

      case 'get_task': {
        const id = String(args.task_id ?? '');
        if (!id) return { error: 'task_id is required' };
        return await getTask(id);
      }

      case 'get_task_comments': {
        const id = String(args.task_id ?? '');
        if (!id) return { error: 'task_id is required' };
        return await getTaskComments(id);
      }

      case 'post_comment': {
        const taskId = String(args.task_id ?? '');
        const body = String(args.body ?? '');
        const commentType = String(args.comment_type ?? 'update');
        if (!taskId || !body) return { error: 'task_id and body are required' };
        const result = await postComment(taskId, ctx.actor.id, body, commentType);
        return { ok: true, comment_id: (result as { id: string }).id };
      }

      case 'update_task_status': {
        const taskId = String(args.task_id ?? '');
        const status = String(args.status ?? '');
        if (!taskId || !status) return { error: 'task_id and status are required' };
        await updateTask(taskId, { status });
        return { ok: true, status };
      }

      case 'assign_task': {
        const taskId = String(args.task_id ?? '');
        const agentId = args.assigned_agent_id === null ? null : String(args.assigned_agent_id ?? '');
        if (!taskId) return { error: 'task_id is required' };
        await updateTask(taskId, { assigned_agent_id: agentId });
        return { ok: true, assigned_agent_id: agentId };
      }

      case 'list_idle_developers':
        return await listIdleDevelopers();

      case 'list_project_tasks':
        return await getProjectTasks(ctx.projectId);

      case 'read_memory_file': {
        const filePath = String(args.file_path ?? '');
        if (!filePath) return { error: 'file_path is required' };
        const result = await readProjectFile(ctx.projectId, filePath);
        if (result.is_binary) return { error: 'file is binary' };
        return { content: result.content, size: result.size };
      }

      case 'get_project':
        return await getProject(ctx.projectId);

      case 'get_project_comments':
        return await getProjectComments(ctx.projectId);

      case 'post_project_comment': {
        const body = String(args.body ?? '');
        const commentType = String(args.comment_type ?? 'update');
        if (!body) return { error: 'body is required' };
        const result = await postProjectComment(
          ctx.projectId,
          ctx.actor.id,
          body,
          commentType,
        );
        return { ok: true, comment_id: (result as { id: string }).id };
      }

      // ─── Developer tools (openapidev only — gated by the tool list
      //     returned from getToolDefinitions, so openapicoor can never
      //     call them even if it hallucinates the name) ───────────────

      case 'read_file': {
        const resolved = resolveInsideRepo(ctx, String(args.path ?? ''));
        if (!resolved.ok) return { error: resolved.error };
        try {
          const st = await stat(resolved.abs);
          if (!st.isFile()) return { error: 'not a file' };
          const buf = await readFile(resolved.abs);
          const truncated = buf.length > MAX_READ_BYTES;
          const slice = truncated ? buf.subarray(0, MAX_READ_BYTES) : buf;
          return {
            path: resolved.rel,
            size: st.size,
            truncated,
            content: slice.toString('utf-8'),
          };
        } catch (err) {
          return { error: (err as Error).message };
        }
      }

      case 'write_file': {
        const resolved = resolveInsideRepo(ctx, String(args.path ?? ''));
        if (!resolved.ok) return { error: resolved.error };
        const content = String(args.content ?? '');
        if (Buffer.byteLength(content, 'utf-8') > MAX_WRITE_BYTES) {
          return { error: `content exceeds ${MAX_WRITE_BYTES} bytes` };
        }
        try {
          await mkdir(dirname(resolved.abs), { recursive: true });
          const tmp = `${resolved.abs}.${process.pid}.${Date.now()}.tmp`;
          await writeFile(tmp, content, 'utf-8');
          await rename(tmp, resolved.abs);
          return {
            ok: true,
            path: resolved.rel,
            bytes: Buffer.byteLength(content, 'utf-8'),
          };
        } catch (err) {
          return { error: (err as Error).message };
        }
      }

      case 'list_files': {
        const inputPath =
          args.path === undefined || args.path === null || args.path === ''
            ? '.'
            : String(args.path);
        const resolved = resolveInsideRepo(ctx, inputPath);
        if (!resolved.ok) return { error: resolved.error };
        try {
          const entries = await readdir(resolved.abs, { withFileTypes: true });
          const slice = entries.slice(0, MAX_DIR_ENTRIES);
          return {
            path: resolved.rel,
            truncated: entries.length > MAX_DIR_ENTRIES,
            entries: slice.map((e) => ({
              name: e.name,
              type: e.isDirectory() ? 'directory' : e.isFile() ? 'file' : 'other',
            })),
          };
        } catch (err) {
          return { error: (err as Error).message };
        }
      }

      case 'run_shell': {
        if (!ctx.repoPath) return { error: 'project has no repo_path configured' };
        const command = String(args.command ?? '').trim();
        if (!command) return { error: 'command is required' };
        const requested = Number(args.timeout_seconds);
        const timeoutMs =
          Number.isFinite(requested) && requested > 0
            ? Math.min(requested * 1000, MAX_SHELL_TIMEOUT_MS)
            : DEFAULT_SHELL_TIMEOUT_MS;
        try {
          const result = await execa(command, {
            cwd: ctx.repoPath,
            shell: '/bin/bash',
            timeout: timeoutMs,
            reject: false,
            all: false,
            stripFinalNewline: false,
          });
          const stdout = truncate(result.stdout ?? '', MAX_SHELL_OUTPUT_BYTES);
          const stderr = truncate(result.stderr ?? '', MAX_SHELL_OUTPUT_BYTES);
          return {
            exit_code: result.exitCode ?? null,
            timed_out: result.timedOut ?? false,
            stdout: stdout.text,
            stdout_truncated: stdout.truncated,
            stderr: stderr.text,
            stderr_truncated: stderr.truncated,
          };
        } catch (err) {
          return { error: (err as Error).message };
        }
      }

      default:
        warn('tools', `Unknown tool: ${name}`);
        return { error: `unknown tool: ${name}` };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warn('tools', `${name} failed: ${msg.slice(0, 200)}`);
    return { error: msg };
  }
}

/**
 * Return the tool schemas the model should see for this role.
 *
 *   openapicoor → coordinator tools only (no filesystem / shell)
 *   openapidev  → coordinator tools + developer tools (read/write/shell)
 *
 * openapicoor can never CALL developer tools — if the model hallucinates
 * the name anyway, executeTool falls through to the "unknown tool" branch
 * because these cases live in the same switch but are never advertised.
 * (That's intentional: one dispatcher is easier to reason about than two.)
 */
export function getToolDefinitions(role: string | null) {
  if (role === 'openapidev') {
    return [...COORDINATOR_TOOLS, ...DEVELOPER_TOOLS];
  }
  return COORDINATOR_TOOLS;
}
