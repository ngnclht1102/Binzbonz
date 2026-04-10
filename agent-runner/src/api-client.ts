import type { Actor, WakeEvent, Comment } from './types.js';
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
  return res.json() as Promise<T>;
}

export const getPendingEvents = () =>
  request<WakeEvent[]>('/wake-events?status=pending');

export const getProcessingEvents = () =>
  request<WakeEvent[]>('/wake-events?status=processing');

export const getActors = () =>
  request<Actor[]>('/actors');

export const getActor = (id: string) =>
  request<Actor>(`/actors/${id}`);

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
