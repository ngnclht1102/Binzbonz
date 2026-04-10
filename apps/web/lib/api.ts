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
  return res.json() as Promise<T>;
}

// Types
export interface Actor {
  id: string;
  name: string;
  type: string;
  role: string | null;
  status: string;
  session_id: string | null;
  last_token_count: number;
  last_active_at: string | null;
  created_at: string;
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

export const createActor = (data: { name: string; type: string; role?: string }) =>
  request<Actor>("/actors", { method: "POST", body: JSON.stringify(data) });

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
export const createProject = (data: { name: string; brief: string; repo_path?: string }) =>
  request<Project>("/projects", { method: "POST", body: JSON.stringify(data) });
export const updateProject = (id: string, data: Partial<Project>) =>
  request<Project>(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(data) });

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

// SSE
export const API_SSE_URL = `${API_URL}/events/stream`;
