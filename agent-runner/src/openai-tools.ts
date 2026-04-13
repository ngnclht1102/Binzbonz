/**
 * OpenAI function-calling tools exposed to openapidev / openapicoor agents.
 *
 * Each tool is a JSON schema (sent to the model) plus an executor that
 * proxies to the Binzbonz HTTP API. The executor closes over the actor and
 * project so the model can't address tasks/projects it shouldn't.
 *
 * The bot can ONLY do what's listed here. No filesystem, shell, or git.
 */

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

// ─── Tool schemas (sent to the model verbatim) ──────────────────────────

export const TOOL_DEFINITIONS = [
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
        'when writing the project brief into a @ctbaceo ping.',
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
        'already pinged ctbaceo recently — do not duplicate pings.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'post_project_comment',
      description:
        'Post a comment on the PROJECT itself (not on a task). Use this ' +
        'when there are no tasks yet and you need to @mention ctbaceo to ' +
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

export interface ToolContext {
  actor: Actor;
  projectId: string;
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
