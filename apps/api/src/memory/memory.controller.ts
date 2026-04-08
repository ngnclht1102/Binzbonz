import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { MemoryService } from './memory.service.js';

@Controller()
export class MemoryController {
  constructor(private readonly service: MemoryService) {}

  @Get('projects/:projectId/memory-files')
  findByProject(@Param('projectId') projectId: string) {
    return this.service.findByProject(projectId);
  }

  @Get('projects/:projectId/memory-files/changed')
  findChangedSince(
    @Param('projectId') projectId: string,
    @Query('since') since: string,
  ) {
    return this.service.findChangedSince(projectId, since);
  }

  @Post('projects/:projectId/memory-files')
  create(
    @Param('projectId') projectId: string,
    @Body() dto: { file_path: string; last_updated_by?: string; git_commit?: string },
  ) {
    return this.service.create(projectId, dto);
  }

  @Patch('memory-files/:id')
  update(
    @Param('id') id: string,
    @Body() dto: { last_updated_by?: string; git_commit?: string },
  ) {
    return this.service.update(id, dto);
  }
}
