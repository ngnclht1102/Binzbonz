import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
} from '@nestjs/common';
import { HierarchyService } from './hierarchy.service.js';
import {
  CreateMvpDto, UpdateMvpDto,
  CreateSprintDto, UpdateSprintDto,
  CreateEpicDto, UpdateEpicDto,
  CreateFeatureDto, UpdateFeatureDto,
} from './dto/hierarchy.dto.js';

@Controller()
export class HierarchyController {
  constructor(private readonly service: HierarchyService) {}

  // --- MVPs ---
  @Get('projects/:projectId/mvps')
  findMvps(@Param('projectId') projectId: string) {
    return this.service.findMvps(projectId);
  }
  @Post('projects/:projectId/mvps')
  createMvp(@Param('projectId') projectId: string, @Body() dto: CreateMvpDto) {
    return this.service.createMvp(projectId, dto);
  }
  @Patch('mvps/:id')
  updateMvp(@Param('id') id: string, @Body() dto: UpdateMvpDto) {
    return this.service.updateMvp(id, dto);
  }
  @Delete('mvps/:id')
  removeMvp(@Param('id') id: string) {
    return this.service.removeMvp(id);
  }

  // --- Sprints ---
  @Get('mvps/:mvpId/sprints')
  findSprints(@Param('mvpId') mvpId: string) {
    return this.service.findSprints(mvpId);
  }
  @Post('mvps/:mvpId/sprints')
  createSprint(@Param('mvpId') mvpId: string, @Body() dto: CreateSprintDto) {
    return this.service.createSprint(mvpId, dto);
  }
  @Patch('sprints/:id')
  updateSprint(@Param('id') id: string, @Body() dto: UpdateSprintDto) {
    return this.service.updateSprint(id, dto);
  }
  @Delete('sprints/:id')
  removeSprint(@Param('id') id: string) {
    return this.service.removeSprint(id);
  }

  // --- Epics ---
  @Get('sprints/:sprintId/epics')
  findEpics(@Param('sprintId') sprintId: string) {
    return this.service.findEpics(sprintId);
  }
  @Post('sprints/:sprintId/epics')
  createEpic(@Param('sprintId') sprintId: string, @Body() dto: CreateEpicDto) {
    return this.service.createEpic(sprintId, dto);
  }
  @Patch('epics/:id')
  updateEpic(@Param('id') id: string, @Body() dto: UpdateEpicDto) {
    return this.service.updateEpic(id, dto);
  }
  @Delete('epics/:id')
  removeEpic(@Param('id') id: string) {
    return this.service.removeEpic(id);
  }

  // --- Features ---
  @Get('epics/:epicId/features')
  findFeatures(@Param('epicId') epicId: string) {
    return this.service.findFeatures(epicId);
  }
  @Post('epics/:epicId/features')
  createFeature(@Param('epicId') epicId: string, @Body() dto: CreateFeatureDto) {
    return this.service.createFeature(epicId, dto);
  }
  @Patch('features/:id')
  updateFeature(@Param('id') id: string, @Body() dto: UpdateFeatureDto) {
    return this.service.updateFeature(id, dto);
  }
  @Delete('features/:id')
  removeFeature(@Param('id') id: string) {
    return this.service.removeFeature(id);
  }
}
