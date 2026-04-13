export interface Actor {
  id: string;
  name: string;
  type: string;
  role: string | null;
  status: string;
  // OpenAI-compatible provider config (only set for openapidev / openapicoor).
  // The api_key field arrives RAW from the API for runner-side use only —
  // never log it, never expose it.
  provider_base_url: string | null;
  provider_model: string | null;
  provider_api_key: string | null;
  heartbeat_enabled: boolean;
  heartbeat_interval_seconds: number;
  heartbeat_last_at: string | null;
}

/** Per-project session row, returned from the API. */
export interface AgentProjectSession {
  id: string;
  agent_id: string;
  project_id: string;
  session_id: string | null;
  /** Only populated when fetched via include_messages=true. */
  message_history?: OpenAIMessage[];
  last_token_count: number;
  last_active_at: string | null;
}

/**
 * OpenAI chat completion message shape, plus an optional `_ts` timestamp
 * field that we add when persisting so the chat UI can display when each
 * message arrived. Older rows in the DB without `_ts` just render without
 * a timestamp. The provider ignores extra fields.
 */
export type OpenAIMessage =
  | { role: 'system'; content: string; _ts?: string }
  | { role: 'user'; content: string; _ts?: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: OpenAIToolCall[];
      _ts?: string;
    }
  | { role: 'tool'; tool_call_id: string; content: string; _ts?: string };

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
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
