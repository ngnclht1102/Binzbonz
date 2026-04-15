import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { ActorsService } from './actors.service.js';
import { CreateActorDto } from './dto/create-actor.dto.js';
import { UpdateActorDto } from './dto/update-actor.dto.js';
import { HeartbeatDto } from './dto/heartbeat.dto.js';
import { ProviderConfigDto } from './dto/provider-config.dto.js';

@Controller('actors')
export class ActorsController {
  constructor(private readonly service: ActorsService) {}

  @Get()
  findAll(
    @Query('type') type?: string,
    @Query('role') role?: string,
    @Query('status') status?: string,
  ) {
    return this.service.findAll({ type, role, status });
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @Query('include_secrets') includeSecrets?: string,
  ) {
    // include_secrets=true returns the unredacted row including provider_api_key.
    // Reserved for trusted server-side callers (the agent runner). The
    // frontend never uses this. There's no auth layer in v1, so this is
    // localhost-only.
    if (includeSecrets === 'true') {
      return this.service.findOneRaw(id);
    }
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateActorDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateActorDto) {
    return this.service.update(id, dto);
  }

  // Append a chunk to the live_output tail. Called by agent-runner ~1.5s
  // while a wake is in flight. Kept separate from PATCH /:id so it doesn't
  // collide with arbitrary field updates and so the cap/clear logic lives
  // in one place.
  @Patch(':id/live-output')
  appendLiveOutput(
    @Param('id') id: string,
    @Body() dto: { chunk: string },
  ) {
    return this.service.appendLiveOutput(id, dto?.chunk ?? '');
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  // ─── Heartbeat ─────────────────────────────────────────────────────────

  @Patch(':id/heartbeat')
  setHeartbeat(@Param('id') id: string, @Body() dto: HeartbeatDto) {
    return this.service.setHeartbeat(id, dto);
  }

  // ─── Provider config (OpenAI agents only) ──────────────────────────────

  @Patch(':id/provider-config')
  updateProviderConfig(
    @Param('id') id: string,
    @Body() dto: ProviderConfigDto,
    @Query('verify') verify?: string,
  ) {
    return this.service.updateProviderConfig(id, dto, verify === 'true');
  }
}
