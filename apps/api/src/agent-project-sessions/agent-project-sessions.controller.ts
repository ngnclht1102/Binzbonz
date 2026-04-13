import {
  Controller,
  Get,
  Post,
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
import { WakeEventsService } from '../wake-events/wake-events.service.js';
import { ActorsService } from '../actors/actors.service.js';

const OPENAPI_ROLES = new Set(['openapidev', 'openapicoor']);

@Controller('agent-project-sessions')
export class AgentProjectSessionsController {
  constructor(
    private readonly service: AgentProjectSessionsService,
    private readonly wakeEvents: WakeEventsService,
    private readonly actors: ActorsService,
  ) {}

  /**
   * GET /agent-project-sessions?agent_id=...&project_id=...&include_messages=true
   *
   * - agent_id only       → list all sessions for that agent (with project info)
   * - project_id only     → list all sessions for that project (with agent info)
   * - both                → returns the single matching row, or null
   * - neither             → 400
   *
   * include_messages=true (only valid with both ids) returns the FULL row
   * including message_history. Used by the agent runner before each spawn.
   */
  @Get()
  async find(
    @Query('agent_id') agentId?: string,
    @Query('project_id') projectId?: string,
    @Query('include_messages') includeMessages?: string,
  ) {
    if (agentId && projectId) {
      if (includeMessages === 'true') {
        return this.service.findOneRaw(agentId, projectId);
      }
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
   * GET /agent-project-sessions/:id/messages
   * Returns the full message_history for one session row. Used by the chat
   * modal in the UI.
   */
  @Get(':id/messages')
  getMessages(@Param('id') id: string) {
    return this.service.getMessages(id);
  }

  /**
   * POST /agent-project-sessions/:id/chat
   * Body: { content: string }
   *
   * Append a user message to message_history and create a wake event with
   * triggered_by='chat' so the runner picks it up. Returns 202 immediately.
   */
  @Post(':id/chat')
  async chat(@Param('id') id: string, @Body() body: { content?: string }) {
    if (!body.content || !body.content.trim()) {
      throw new BadRequestException('content is required');
    }
    const row = await this.service.findById(id);
    const actor = await this.actors.findOneRaw(row.agent_id);
    if (!OPENAPI_ROLES.has(actor.role ?? '')) {
      throw new BadRequestException(
        'Chat is only supported for openapidev / openapicoor agents',
      );
    }

    await this.service.appendUserMessage(id, body.content.trim());
    const wake = await this.wakeEvents.create({
      agent_id: row.agent_id,
      project_id: row.project_id,
      triggered_by: 'chat',
    });
    return { accepted: true, wake_event_id: wake.id };
  }

  /**
   * PATCH /agent-project-sessions
   * Upserts by (agent_id, project_id). Used by the agent runner.
   *
   * Body: { agent_id, project_id, session_id?, last_token_count?, message_history? }
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
