import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Comment } from './comment.entity.js';
import { ProjectComment } from './project-comment.entity.js';
import { CreateCommentDto } from './dto/create-comment.dto.js';
import { MentionParserService } from './mention-parser.service.js';
import { Task } from '../tasks/task.entity.js';

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(Comment)
    private readonly commentRepo: Repository<Comment>,
    @InjectRepository(ProjectComment)
    private readonly projectCommentRepo: Repository<ProjectComment>,
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    private readonly mentionParser: MentionParserService,
  ) {}

  findByTask(taskId: string) {
    return this.commentRepo.find({
      where: { task_id: taskId },
      relations: ['actor'],
      order: { created_at: 'ASC' },
    });
  }

  async createForTask(taskId: string, dto: CreateCommentDto) {
    const comment = await this.commentRepo.save(
      this.commentRepo.create({
        task_id: taskId,
        actor_id: dto.actor_id,
        body: dto.body,
        comment_type: dto.comment_type ?? 'update',
      }),
    );

    // Resolve project_id through task → feature → epic → sprint → mvp
    const task = await this.taskRepo
      .createQueryBuilder('task')
      .innerJoin('task.feature', 'feature')
      .innerJoin('feature.epic', 'epic')
      .innerJoin('epic.sprint', 'sprint')
      .innerJoin('sprint.mvp', 'mvp')
      .select('mvp.project_id', 'project_id')
      .where('task.id = :taskId', { taskId })
      .getRawOne();

    if (task?.project_id) {
      await this.mentionParser.parseMentions(
        dto.body,
        comment.id,
        task.project_id,
        taskId,
      );
    }

    return comment;
  }

  findByProject(projectId: string) {
    return this.projectCommentRepo.find({
      where: { project_id: projectId },
      relations: ['actor'],
      order: { created_at: 'ASC' },
    });
  }

  async createForProject(projectId: string, dto: CreateCommentDto) {
    const comment = await this.projectCommentRepo.save(
      this.projectCommentRepo.create({
        project_id: projectId,
        actor_id: dto.actor_id,
        body: dto.body,
        comment_type: dto.comment_type ?? 'update',
      }),
    );

    await this.mentionParser.parseMentions(dto.body, comment.id, projectId);
    return comment;
  }
}
