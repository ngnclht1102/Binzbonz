export interface Actor {
  id: string;
  name: string;
  type: string;
  role: string | null;
  status: string;
}

/** Per-project session row, returned from the API. */
export interface AgentProjectSession {
  id: string;
  agent_id: string;
  project_id: string;
  session_id: string | null;
  last_token_count: number;
  last_active_at: string | null;
}

export interface Project {
  id: string;
  name: string;
  status: string;
}

export interface WakeEvent {
  id: string;
  agent_id: string;
  project_id: string;
  triggered_by: string;
  comment_id: string | null;
  task_id: string | null;
  status: string;
  agent?: Actor;
  project?: Project;
}

export interface Comment {
  id: string;
  task_id: string;
  body: string;
  comment_type: string;
}
