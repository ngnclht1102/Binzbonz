import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  BadRequestException,
} from '@nestjs/common';
import {
  AgentProjectSessionsService,
  UpsertSessionDto,
} from './agent-project-sessions.service.js';

@Controller('agent-project-sessions')
export class AgentProjectSessionsController {
  constructor(private readonly service: AgentProjectSessionsService) {}

  /**
   * GET /agent-project-sessions?agent_id=...&project_id=...
   *
   * - agent_id only       → list all sessions for that agent (with project info)
   * - project_id only     → list all sessions for that project (with agent info)
   * - both                → returns the single matching row, or null
   * - neither             → 400
   */
  @Get()
  async find(
    @Query('agent_id') agentId?: string,
    @Query('project_id') projectId?: string,
  ) {
    if (agentId && projectId) {
      return this.service.findOne(agentId, projectId);
    }
    if (agentId) {
      return this.service.findByAgent(agentId);
    }
    if (projectId) {
      return this.service.findByProject(projectId);
    }
    throw new BadRequestException('agent_id or project_id is required');
  }

  /**
   * PATCH /agent-project-sessions
   * Upserts by (agent_id, project_id). Used by the agent runner.
   *
   * Body: { agent_id, project_id, session_id?, last_token_count? }
   */
  @Patch()
  upsert(@Body() body: UpsertSessionDto) {
    if (!body.agent_id || !body.project_id) {
      throw new BadRequestException('agent_id and project_id are required');
    }
    return this.service.upsert(body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
