import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { WakeEventsService } from './wake-events.service.js';

@Controller('wake-events')
export class WakeEventsController {
  constructor(private readonly service: WakeEventsService) {}

  @Get()
  findAll(
    @Query('status') status?: string,
    @Query('agent_id') agent_id?: string,
  ) {
    return this.service.findAll({ status, agent_id });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(
    @Body()
    dto: {
      agent_id: string;
      project_id: string;
      triggered_by: string;
      comment_id?: string;
    },
  ) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: { status: string }) {
    return this.service.update(id, dto);
  }
}
