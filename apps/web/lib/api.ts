const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `HTTP ${res.status}`);
  }
  // Handle empty / null bodies (NestJS controllers returning `null` send a
  // 200 with no body, which would otherwise crash res.json()).
  const text = await res.text();
  if (!text) return null as unknown as T;
  return JSON.parse(text) as T;
}

// Types
export interface Actor {
  id: string;
  name: string;
  type: string;
  role: string | null; // developer | master | openapidev | openapicoor | null
  status: string;
  created_at: string;
  // OpenAI provider config (only set for openapidev / openapicoor).
  // The api_key is always returned as `<redacted>` after creation.
  provider_base_url?: string | null;
  provider_model?: string | null;
  provider_api_key?: string | null;
  // Heartbeat config
  heartbeat_enabled?: boolean;
  heartbeat_interval_seconds?: number;
  heartbeat_last_at?: string | null;
  // Rolling tail of the agent's stdout while it's working (128KB cap).
  // Cleared by the API when status flips to idle.
  live_output?: string | null;
  live_output_updated_at?: string | null;
}

export type AgentRole = 'developer' | 'master' | 'openapidev' | 'openapicoor';
export const OPENAPI_ROLES: Set<string> = new Set(['openapidev', 'openapicoor']);
export const isOpenAIRole = (role: string | null): boolean =>
  !!role && OPENAPI_ROLES.has(role);

/**
 * UI-layout question: does this role use the inline "chat slide" pattern
 * (right-side AgentChat panel + Open Conversation modal button)?
 *
 * Only openapicoor does. openapidev is now treated as a regular developer
 * in the UI — it gets the Terminal button + live stream pane, same as
 * Claude developers — because those agents actually write code now. This
 * is separate from `isOpenAIRole` on purpose: provider-config and
 * heartbeat cards still gate on `isOpenAIRole` since both openapi roles
 * still hit an OpenAI-compatible backend.
 */
export const usesChatSlideUI = (role: string | null): boolean =>
  role === 'openapicoor';

/** Per-project session row, joined with project info when listed for an agent. */
export interface AgentProjectSession {
  id: string;
  agent_id: string;
  project_id: string;
  session_id: string | null;
  last_token_count: number;
  last_active_at: string | null;
  created_at: string;
  updated_at: string;
  /** Number of messages in the OpenAI message_history (server-side computed). */
  message_count?: number;
  project?: Project;
  agent?: Actor;
}

/** OpenAI chat message shape — what /messages returns. */
export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  /** ISO timestamp added by the runner / chat endpoint when persisting.
   *  Older messages may not have this field. */
  _ts?: string;
}

export interface SessionMessages {
  id: string;
  agent_id: string;
  project_id: string;
  messages: OpenAIMessage[];
  last_token_count: number;
  last_active_at: string | null;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  brief: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: string;
  assigned_agent: Actor | null;
  assigned_agent_id: string | null;
  parent_task_id: string | null;
  feature_id: string;
  subtasks: Task[];
  priority: number;
  created_at: string;
}

export interface Comment {
  id: string;
  body: string;
  comment_type: string;
  actor: Actor;
  actor_id: string;
  created_at: string;
}

// Actors
export const getActors = (params?: Record<string, string>) => {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return request<Actor[]>(`/actors${qs}`);
};

export const getActor = (id: string) => request<Actor>(`/actors/${id}`);

export const createActor = (data: {
  name: string;
  type: string;
  role?: string;
  provider_base_url?: string;
  provider_model?: string;
  provider_api_key?: string;
}) => request<Actor>("/actors", { method: "POST", body: JSON.stringify(data) });

export const deleteActor = (id: string) =>
  request<{ deleted: boolean; sessions_removed: number }>(
    `/actors/${id}`,
    { method: "DELETE" },
  );

// Heartbeat
export const setActorHeartbeat = (
  id: string,
  data: { enabled: boolean; interval_seconds?: number },
) =>
  request<Actor>(`/actors/${id}/heartbeat`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

// Provider config (OpenAI agents only)
export const updateProviderConfig = (
  id: string,
  data: { base_url?: string; model?: string; api_key?: string },
  verify = false,
) =>
  request<Actor>(
    `/actors/${id}/provider-config${verify ? "?verify=true" : ""}`,
    { method: "PATCH", body: JSON.stringify(data) },
  );

// Agent Project Sessions
export const getAgentProjectSessions = (agentId: string) =>
  request<AgentProjectSession[]>(
    `/agent-project-sessions?agent_id=${encodeURIComponent(agentId)}`,
  );
export const getProjectAgentSessions = (projectId: string) =>
  request<AgentProjectSession[]>(
    `/agent-project-sessions?project_id=${encodeURIComponent(projectId)}`,
  );
export const getAgentProjectSession = (agentId: string, projectId: string) =>
  request<AgentProjectSession | null>(
    `/agent-project-sessions?agent_id=${encodeURIComponent(agentId)}&project_id=${encodeURIComponent(projectId)}`,
  );
export const deleteAgentProjectSession = (id: string) =>
  request<{ deleted: boolean }>(`/agent-project-sessions/${id}`, { method: "DELETE" });

/** Reset a (agent, project) session row — clears session_id and message_history
 *  but keeps the row. Forces a fresh session on next spawn. */
export const resetAgentProjectSession = (id: string) =>
  request<{ reset: boolean; id: string }>(`/agent-project-sessions/${id}/reset`, {
    method: "POST",
  });

/**
 * Find or create the (agent, project) session row. The PATCH endpoint
 * runs upsert via findOrCreate, so passing only the keys creates an empty
 * row when none exists. Used by the chat modal flow when the user wants to
 * open a conversation before any wake event has been processed.
 */
export const ensureAgentProjectSession = (agentId: string, projectId: string) =>
  request<AgentProjectSession>(`/agent-project-sessions`, {
    method: "PATCH",
    body: JSON.stringify({ agent_id: agentId, project_id: projectId }),
  });

/** Full message_history for one (agent, project) session. */
export const getSessionMessages = (id: string) =>
  request<SessionMessages>(`/agent-project-sessions/${id}/messages`);

/** Send a chat message to an OpenAI agent. */
export const sendChatMessage = (sessionId: string, content: string) =>
  request<{ accepted: boolean; wake_event_id: string }>(
    `/agent-project-sessions/${sessionId}/chat`,
    { method: "POST", body: JSON.stringify({ content }) },
  );

// Wake Events
export interface WakeEvent {
  id: string;
  agent_id: string;
  project_id: string;
  task_id: string | null;
  triggered_by: string;
  comment_id: string | null;
  status: string;
  created_at: string;
  agent?: Actor;
  project?: { id: string; name: string };
}

export const getWakeEvents = (params?: Record<string, string>) => {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return request<WakeEvent[]>(`/wake-events${qs}`);
};

// Projects
export const getProjects = () => request<Project[]>("/projects");
export const getProject = (id: string) => request<Project>(`/projects/${id}`);
export const createProject = (data: {
  name: string;
  brief: string;
  repo_path?: string;
  import_path?: string;
}) => request<Project>("/projects", { method: "POST", body: JSON.stringify(data) });
export const updateProject = (id: string, data: Partial<Project>) =>
  request<Project>(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(data) });
export const deleteProject = (id: string, deleteFiles = false) =>
  request<{ deleted: boolean; files_deleted: boolean }>(
    `/projects/${id}${deleteFiles ? "?delete_files=true" : ""}`,
    { method: "DELETE" },
  );

// Filesystem (directory browser)
export interface DirEntry { name: string; path: string; is_directory: boolean; }
export interface BrowseResponse { cwd: string; parent: string | null; entries: DirEntry[]; }

export const browseDirectory = (path?: string) => {
  const qs = path ? `?path=${encodeURIComponent(path)}` : "";
  return request<BrowseResponse>(`/filesystem/browse${qs}`);
};
export const getHomeDir = () => request<{ path: string }>("/filesystem/home");
export const createDirectory = (parent: string, name: string) =>
  request<{ path: string }>("/filesystem/mkdir", {
    method: "POST",
    body: JSON.stringify({ parent, name }),
  });

// Tasks
export const getProjectTasks = (projectId: string) =>
  request<Task[]>(`/projects/${projectId}/tasks`);
export const getTask = (id: string) => request<Task>(`/tasks/${id}`);
export const updateTask = (id: string, data: Partial<Task>) =>
  request<Task>(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(data) });

// Comments
export const getTaskComments = (taskId: string) =>
  request<Comment[]>(`/tasks/${taskId}/comments`);
export const createTaskComment = (
  taskId: string,
  data: { actor_id: string; body: string; comment_type?: string },
) =>
  request<Comment>(`/tasks/${taskId}/comments`, {
    method: "POST",
    body: JSON.stringify(data),
  });

// Hierarchy
export interface Mvp { id: string; title: string; description: string | null; status: string; project_id: string; }
export interface Sprint { id: string; title: string; goal: string | null; mvp_id: string; }
export interface Epic { id: string; title: string; description: string | null; sprint_id: string; }
export interface Feature { id: string; title: string; description: string | null; epic_id: string; }

export const getProjectMvps = (projectId: string) =>
  request<Mvp[]>(`/projects/${projectId}/mvps`);
export const getMvpSprints = (mvpId: string) =>
  request<Sprint[]>(`/mvps/${mvpId}/sprints`);
export const getSprintEpics = (sprintId: string) =>
  request<Epic[]>(`/sprints/${sprintId}/epics`);
export const getEpicFeatures = (epicId: string) =>
  request<Feature[]>(`/epics/${epicId}/features`);
export const getFeatureTasks = (featureId: string) =>
  request<Task[]>(`/features/${featureId}/tasks`);

export const createMvp = (projectId: string, data: { title: string }) =>
  request<Mvp>(`/projects/${projectId}/mvps`, { method: "POST", body: JSON.stringify(data) });
export const createSprint = (mvpId: string, data: { title: string }) =>
  request<Sprint>(`/mvps/${mvpId}/sprints`, { method: "POST", body: JSON.stringify(data) });
export const createEpic = (sprintId: string, data: { title: string }) =>
  request<Epic>(`/sprints/${sprintId}/epics`, { method: "POST", body: JSON.stringify(data) });
export const createFeature = (epicId: string, data: { title: string }) =>
  request<Feature>(`/epics/${epicId}/features`, { method: "POST", body: JSON.stringify(data) });
export const createTask = (featureId: string, data: { title: string; description?: string }) =>
  request<Task>(`/features/${featureId}/tasks`, { method: "POST", body: JSON.stringify(data) });
export const createSubtask = (parentId: string, data: { title: string; description?: string }) =>
  request<Task>(`/tasks/${parentId}/subtasks`, { method: "POST", body: JSON.stringify(data) });

// Auto-create hierarchy up to each level, return the parent ID needed

export async function ensureMvp(projectId: string): Promise<string> {
  let mvps = await getProjectMvps(projectId);
  if (mvps.length === 0) mvps = [await createMvp(projectId, { title: "MVP 1" })];
  return mvps[0].id;
}

export async function ensureSprint(projectId: string): Promise<string> {
  const mvpId = await ensureMvp(projectId);
  let sprints = await getMvpSprints(mvpId);
  if (sprints.length === 0) sprints = [await createSprint(mvpId, { title: "Sprint 1" })];
  return sprints[0].id;
}

export async function ensureEpic(projectId: string): Promise<string> {
  const sprintId = await ensureSprint(projectId);
  let epics = await getSprintEpics(sprintId);
  if (epics.length === 0) epics = [await createEpic(sprintId, { title: "General" })];
  return epics[0].id;
}

export async function ensureFeature(projectId: string): Promise<string> {
  const epicId = await ensureEpic(projectId);
  let features = await getEpicFeatures(epicId);
  if (features.length === 0) features = [await createFeature(epicId, { title: "General" })];
  return features[0].id;
}

export const ensureDefaultHierarchy = ensureFeature;

// Project Files (file tree + editor)
export interface ProjectFileEntry {
  name: string;
  is_directory: boolean;
  size: number | null;
  mtime: string;
}
export interface ProjectFileBrowse {
  cwd: string;
  relative: string;
  parent: string | null;
  entries: ProjectFileEntry[];
}
export interface ProjectFileRead {
  path: string;
  content: string;
  mtime: string;
  size: number;
  is_binary: boolean;
}
export interface ProjectFileStat {
  mtime: string;
  size: number;
  is_directory: boolean;
}

export const browseProjectFiles = (projectId: string, path?: string) => {
  const qs = path ? `?path=${encodeURIComponent(path)}` : "";
  return request<ProjectFileBrowse>(`/projects/${projectId}/files${qs}`);
};

export const readProjectFile = (projectId: string, path: string) =>
  request<ProjectFileRead>(
    `/projects/${projectId}/files/read?path=${encodeURIComponent(path)}`,
  );

export const statProjectFile = (projectId: string, path: string) =>
  request<ProjectFileStat>(
    `/projects/${projectId}/files/stat?path=${encodeURIComponent(path)}`,
  );

export const writeProjectFile = (
  projectId: string,
  data: { path: string; content: string; expected_mtime?: string },
) =>
  request<{ path: string; mtime: string; size: number }>(
    `/projects/${projectId}/files/write`,
    { method: "POST", body: JSON.stringify(data) },
  );

export const mkdirProjectFile = (projectId: string, parent: string, name: string) =>
  request<{ path: string }>(`/projects/${projectId}/files/mkdir`, {
    method: "POST",
    body: JSON.stringify({ parent, name }),
  });

export const touchProjectFile = (projectId: string, parent: string, name: string) =>
  request<{ path: string }>(`/projects/${projectId}/files/touch`, {
    method: "POST",
    body: JSON.stringify({ parent, name }),
  });

export const deleteProjectFile = (projectId: string, path: string) =>
  request<{ deleted: boolean; path: string }>(
    `/projects/${projectId}/files?path=${encodeURIComponent(path)}`,
    { method: "DELETE" },
  );

export const copyProjectFile = (projectId: string, from: string, to: string) =>
  request<{ from: string; to: string }>(`/projects/${projectId}/files/copy`, {
    method: "POST",
    body: JSON.stringify({ from, to }),
  });

export const moveProjectFile = (projectId: string, from: string, to: string) =>
  request<{ from: string; to: string }>(`/projects/${projectId}/files/move`, {
    method: "POST",
    body: JSON.stringify({ from, to }),
  });

// SSE
export const API_SSE_URL = `${API_URL}/events/stream`;
