import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Comment } from './comment.entity.js';
import { ProjectComment } from './project-comment.entity.js';
import { CreateCommentDto } from './dto/create-comment.dto.js';
import { MentionParserService } from './mention-parser.service.js';
import { Task } from '../tasks/task.entity.js';

@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);

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
    this.logger.log(`Creating comment on task ${taskId.slice(0, 8)} by actor ${dto.actor_id.slice(0, 8)} (${dto.comment_type ?? 'update'})`);
    const comment = await this.commentRepo.save(
      this.commentRepo.create({
        task_id: taskId,
        actor_id: dto.actor_id,
        body: dto.body,
        comment_type: dto.comment_type ?? 'update',
      }),
    );
    this.logger.log(`Comment created: ${comment.id.slice(0, 8)} on task ${taskId.slice(0, 8)}`);

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
    } else {
      this.logger.warn(`Could not resolve project_id for task ${taskId.slice(0, 8)} — skipping mention parsing`);
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
    this.logger.log(`Creating project comment on project ${projectId.slice(0, 8)} by actor ${dto.actor_id.slice(0, 8)}`);
    const comment = await this.projectCommentRepo.save(
      this.projectCommentRepo.create({
        project_id: projectId,
        actor_id: dto.actor_id,
        body: dto.body,
        comment_type: dto.comment_type ?? 'update',
      }),
    );
    this.logger.log(`Project comment created: ${comment.id.slice(0, 8)}`);

    await this.mentionParser.parseMentions(dto.body, comment.id, projectId);
    return comment;
  }
}
