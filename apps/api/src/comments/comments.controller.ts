import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { CommentsService } from './comments.service.js';
import { CreateCommentDto } from './dto/create-comment.dto.js';

@Controller()
export class CommentsController {
  constructor(private readonly service: CommentsService) {}

  @Get('tasks/:taskId/comments')
  findByTask(@Param('taskId') taskId: string) {
    return this.service.findByTask(taskId);
  }

  @Post('tasks/:taskId/comments')
  createForTask(
    @Param('taskId') taskId: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.service.createForTask(taskId, dto);
  }

  @Get('projects/:projectId/comments')
  findByProject(@Param('projectId') projectId: string) {
    return this.service.findByProject(projectId);
  }

  @Post('projects/:projectId/comments')
  createForProject(
    @Param('projectId') projectId: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.service.createForProject(projectId, dto);
  }
}
