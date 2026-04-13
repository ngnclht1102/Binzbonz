import type { Actor, AgentProjectSession, WakeEvent, Comment } from './types.js';
import { log, error as logError, debug } from './logger.js';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const method = options?.method ?? 'GET';
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!res.ok) {
    const body = await res.text();
    logError('api-client', `${method} ${path} -> ${res.status} ERROR: ${body.slice(0, 200)}`);
    throw new Error(`API ${res.status}: ${body}`);
  }
  debug('api-client', `${method} ${path} -> ${res.status}`);
  // Read as text first so we can handle 204 / empty bodies (NestJS returns
  // an empty body when a controller returns `null`, which would otherwise
  // crash res.json() with "Unexpected end of JSON input").
  const text = await res.text();
  if (!text) return null as unknown as T;
  return JSON.parse(text) as T;
}

export const getPendingEvents = () =>
  request<WakeEvent[]>('/wake-events?status=pending');

export const getProcessingEvents = () =>
  request<WakeEvent[]>('/wake-events?status=processing');

export const getActors = () =>
  request<Actor[]>('/actors');

export const getActor = (id: string) =>
  request<Actor>(`/actors/${id}`);

/**
 * Get the actor with the unredacted provider_api_key. Only used by the
 * runner for OpenAI agents — never log this or pass it through anywhere
 * other than the spawner.
 */
export const getActorWithSecrets = (id: string) =>
  request<Actor>(`/actors/${id}?include_secrets=true`);

export const getProject = (id: string) =>
  request<{ id: string; name: string; brief: string | null; status: string; repo_path: string | null }>(`/projects/${id}`);

export const getTask = (id: string) =>
  request<{ id: string; title: string; description: string | null; status: string }>(`/tasks/${id}`);

export const updateWakeEvent = (id: string, status: string) =>
  request<WakeEvent>(`/wake-events/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });

export const updateActor = (id: string, data: Partial<Actor>) =>
  request<Actor>(`/actors/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

export const postComment = (taskId: string, actorId: string, body: string, commentType = 'update') =>
  request<Comment>(`/tasks/${taskId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ actor_id: actorId, body, comment_type: commentType }),
  });

export const getTaskComments = (taskId: string) =>
  request<Comment[]>(`/tasks/${taskId}/comments`);

export const getChangedMemoryFiles = (projectId: string, since: string) =>
  request<{ file_path: string }[]>(
    `/projects/${projectId}/memory-files/changed?since=${encodeURIComponent(since)}`,
  );

/**
 * Look up the per-project session row for (agent, project). Returns null if
 * the row doesn't exist yet. Slim — does not include message_history.
 */
export const getAgentProjectSession = (agentId: string, projectId: string) =>
  request<AgentProjectSession | null>(
    `/agent-project-sessions?agent_id=${agentId}&project_id=${projectId}`,
  );

/**
 * Look up the per-project session row INCLUDING message_history. Used by
 * the OpenAI spawner before each call (Claude doesn't need this).
 */
export const getAgentProjectSessionWithMessages = (agentId: string, projectId: string) =>
  request<AgentProjectSession | null>(
    `/agent-project-sessions?agent_id=${agentId}&project_id=${projectId}&include_messages=true`,
  );

/**
 * Upsert the per-project session row. The runner calls this after every spawn
 * to write back the new session_id / message_history / token count and bump
 * last_active_at.
 */
export const upsertAgentProjectSession = (
  agentId: string,
  projectId: string,
  data: {
    session_id?: string | null;
    last_token_count?: number;
    message_history?: unknown[];
  },
) =>
  request<AgentProjectSession>(`/agent-project-sessions`, {
    method: 'PATCH',
    body: JSON.stringify({ agent_id: agentId, project_id: projectId, ...data }),
  });

// ─── Tools API surface (used by OpenAI tool dispatcher) ─────────────────

export const updateTask = (id: string, data: Record<string, unknown>) =>
  request<unknown>(`/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

export const getProjectTasks = (projectId: string) =>
  request<unknown[]>(`/projects/${projectId}/tasks`);

export const getActorTasks = (actorId: string) =>
  request<unknown[]>(`/actors/${actorId}/tasks`);

export const listIdleDevelopers = () =>
  request<Actor[]>(`/actors?type=agent&role=developer&status=idle`);

/** Post a comment on the project itself (not on any task). Used by the
 *  coordinator when a project has no tasks and it needs to wake ctbaceo
 *  to break down the brief. Mentions in the body will still trigger wake
 *  events via the mention parser. */
export const postProjectComment = (
  projectId: string,
  actorId: string,
  body: string,
  commentType = 'update',
) =>
  request<Comment>(`/projects/${projectId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ actor_id: actorId, body, comment_type: commentType }),
  });

/** Read project-level comments. */
export const getProjectComments = (projectId: string) =>
  request<Comment[]>(`/projects/${projectId}/comments`);

/**
 * Read a file from the project workspace via the existing project files
 * endpoint. The OpenAI bot's `read_memory_file` tool calls this with paths
 * scoped to the `memory/` directory.
 */
export const readProjectFile = (projectId: string, filePath: string) =>
  request<{ content: string; is_binary: boolean; size: number }>(
    `/projects/${projectId}/files/read?path=${encodeURIComponent(filePath)}`,
  );
