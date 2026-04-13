import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentProjectSession } from './agent-project-session.entity.js';

export interface UpsertSessionDto {
  agent_id: string;
  project_id: string;
  session_id?: string | null;
  last_token_count?: number;
  message_history?: unknown[];
}

/**
 * Session shape returned over the wire — strips message_history to keep list
 * payloads light. Use this everywhere except the dedicated /messages endpoint.
 */
export type SessionListItem = Omit<AgentProjectSession, 'message_history'> & {
  message_count: number;
};

function stripHistory(row: AgentProjectSession): SessionListItem {
  const { message_history, ...rest } = row;
  return {
    ...rest,
    message_count: Array.isArray(message_history) ? message_history.length : 0,
  };
}

@Injectable()
export class AgentProjectSessionsService {
  constructor(
    @InjectRepository(AgentProjectSession)
    private readonly repo: Repository<AgentProjectSession>,
  ) {}

  /** All rows for a given agent, joined with project info. */
  async findByAgent(agentId: string): Promise<SessionListItem[]> {
    const rows = await this.repo.find({
      where: { agent_id: agentId },
      relations: ['project'],
      order: { last_active_at: 'DESC' },
    });
    return rows.map(stripHistory);
  }

  /** All rows for a given project, joined with agent info. */
  async findByProject(projectId: string): Promise<SessionListItem[]> {
    const rows = await this.repo.find({
      where: { project_id: projectId },
      relations: ['agent'],
      order: { last_active_at: 'DESC' },
    });
    return rows.map(stripHistory);
  }

  /**
   * Get the row for one (agent, project) pair, or null if missing.
   * This is the public/HTTP variant — strips message_history to stay light.
   */
  async findOne(agentId: string, projectId: string): Promise<SessionListItem | null> {
    const row = await this.findOneRaw(agentId, projectId);
    return row ? stripHistory(row) : null;
  }

  /** Internal lookup that returns the full row including message_history. */
  findOneRaw(agentId: string, projectId: string) {
    return this.repo.findOne({
      where: { agent_id: agentId, project_id: projectId },
    });
  }

  /** Internal: get a row by primary id. */
  async findById(id: string) {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`AgentProjectSession ${id} not found`);
    return row;
  }

  /** Public messages endpoint — returns the full message_history for one row. */
  async getMessages(id: string) {
    const row = await this.findById(id);
    return {
      id: row.id,
      agent_id: row.agent_id,
      project_id: row.project_id,
      messages: row.message_history,
      last_token_count: row.last_token_count,
      last_active_at: row.last_active_at,
    };
  }

  /**
   * Find or create a row for (agent, project). The runner calls this before
   * every spawn to read the session_id for resume.
   */
  async findOrCreate(agentId: string, projectId: string): Promise<AgentProjectSession> {
    const existing = await this.findOneRaw(agentId, projectId);
    if (existing) return existing;
    const created = this.repo.create({
      agent_id: agentId,
      project_id: projectId,
      session_id: null,
      message_history: [],
      last_token_count: 0,
      last_active_at: null,
    });
    return this.repo.save(created);
  }

  /**
   * Upsert by (agent_id, project_id). Used by the runner after every spawn to
   * write back the new session_id / message_history / token count, and to bump
   * last_active_at.
   */
  async upsert(dto: UpsertSessionDto): Promise<AgentProjectSession> {
    const row = await this.findOrCreate(dto.agent_id, dto.project_id);
    if (dto.session_id !== undefined) row.session_id = dto.session_id;
    if (dto.last_token_count !== undefined) row.last_token_count = dto.last_token_count;
    if (dto.message_history !== undefined) row.message_history = dto.message_history;
    row.last_active_at = new Date();
    return this.repo.save(row);
  }

  /**
   * Append a user message to message_history. Used by the chat send endpoint
   * for OpenAI agents — the human types in the chat modal, this writes their
   * message into history, then a wake event is created so the runner picks up.
   */
  async appendUserMessage(id: string, content: string): Promise<AgentProjectSession> {
    const row = await this.findById(id);
    const history = Array.isArray(row.message_history) ? row.message_history : [];
    row.message_history = [
      ...history,
      { role: 'user', content, _ts: new Date().toISOString() },
    ];
    return this.repo.save(row);
  }

  /** Manually drop a row (forces a fresh session on next spawn). */
  async remove(id: string) {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`AgentProjectSession ${id} not found`);
    await this.repo.remove(row);
    return { deleted: true };
  }
}
