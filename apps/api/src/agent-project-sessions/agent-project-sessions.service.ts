import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentProjectSession } from './agent-project-session.entity.js';

export interface UpsertSessionDto {
  agent_id: string;
  project_id: string;
  session_id?: string | null;
  last_token_count?: number;
}

@Injectable()
export class AgentProjectSessionsService {
  constructor(
    @InjectRepository(AgentProjectSession)
    private readonly repo: Repository<AgentProjectSession>,
  ) {}

  /** All rows for a given agent, joined with project info. */
  findByAgent(agentId: string) {
    return this.repo.find({
      where: { agent_id: agentId },
      relations: ['project'],
      order: { last_active_at: 'DESC' },
    });
  }

  /** All rows for a given project, joined with agent info. */
  findByProject(projectId: string) {
    return this.repo.find({
      where: { project_id: projectId },
      relations: ['agent'],
      order: { last_active_at: 'DESC' },
    });
  }

  /** Get the row for one (agent, project) pair, or null if missing. */
  findOne(agentId: string, projectId: string) {
    return this.repo.findOne({
      where: { agent_id: agentId, project_id: projectId },
    });
  }

  /**
   * Find or create a row for (agent, project). The runner calls this before
   * every spawn to read the session_id for resume.
   */
  async findOrCreate(agentId: string, projectId: string): Promise<AgentProjectSession> {
    const existing = await this.findOne(agentId, projectId);
    if (existing) return existing;
    const created = this.repo.create({
      agent_id: agentId,
      project_id: projectId,
      session_id: null,
      last_token_count: 0,
      last_active_at: null,
    });
    return this.repo.save(created);
  }

  /**
   * Upsert by (agent_id, project_id). Used by the runner after every spawn to
   * write back the new session_id and token count, and to bump last_active_at.
   */
  async upsert(dto: UpsertSessionDto): Promise<AgentProjectSession> {
    const row = await this.findOrCreate(dto.agent_id, dto.project_id);
    if (dto.session_id !== undefined) row.session_id = dto.session_id;
    if (dto.last_token_count !== undefined) row.last_token_count = dto.last_token_count;
    row.last_active_at = new Date();
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
