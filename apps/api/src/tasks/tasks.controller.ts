import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
} from '@nestjs/common';
import { TasksService } from './tasks.service.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { UpdateTaskDto } from './dto/update-task.dto.js';

@Controller()
export class TasksController {
  constructor(private readonly service: TasksService) {}

  @Get('features/:featureId/tasks')
  findByFeature(@Param('featureId') featureId: string) {
    return this.service.findByFeature(featureId);
  }

  @Get('projects/:projectId/tasks')
  findByProject(@Param('projectId') projectId: string) {
    return this.service.findByProject(projectId);
  }

  @Get('actors/:actorId/tasks')
  findByAssignee(@Param('actorId') actorId: string) {
    return this.service.findByAssignee(actorId);
  }

  @Get('tasks/:id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post('features/:featureId/tasks')
  createForFeature(
    @Param('featureId') featureId: string,
    @Body() dto: CreateTaskDto,
  ) {
    return this.service.createForFeature(featureId, dto);
  }

  @Post('tasks/:parentId/subtasks')
  createSubtask(
    @Param('parentId') parentId: string,
    @Body() dto: CreateTaskDto,
  ) {
    return this.service.createSubtask(parentId, dto);
  }

  @Patch('tasks/:id')
  update(@Param('id') id: string, @Body() dto: UpdateTaskDto) {
    return this.service.update(id, dto);
  }

  @Delete('tasks/:id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
