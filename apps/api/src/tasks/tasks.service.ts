import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { Task } from './task.entity.js';
import { WakeEvent } from '../wake-events/wake-event.entity.js';
import { Project } from '../projects/project.entity.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { UpdateTaskDto } from './dto/update-task.dto.js';

// Task state machine. Liberal on purpose: agents do an entire task in one
// wake event, so forcing them through intermediate `in_progress` updates
// is noise. Any "active" state (assigned / in_progress / blocked /
// review_request) can move directly to any other active state, or to
// done / cancelled.
const VALID_TRANSITIONS: Record<string, string[]> = {
  backlog: ['assigned', 'in_progress', 'cancelled'],
  assigned: ['in_progress', 'blocked', 'review_request', 'done', 'backlog', 'cancelled'],
  in_progress: ['assigned', 'blocked', 'review_request', 'done', 'cancelled'],
  blocked: ['assigned', 'in_progress', 'review_request', 'done', 'cancelled'],
  review_request: ['assigned', 'in_progress', 'blocked', 'done', 'cancelled'],
  done: ['backlog', 'assigned', 'in_progress'],
  cancelled: ['backlog', 'assigned', 'in_progress'],
};

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @InjectRepository(Task)
    private readonly repo: Repository<Task>,
    @InjectRepository(WakeEvent)
    private readonly wakeEventRepo: Repository<WakeEvent>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
  ) {}

  findByFeature(featureId: string) {
    return this.repo.find({
      where: { feature_id: featureId, parent_task_id: undefined },
      relations: ['assigned_agent', 'subtasks', 'subtasks.assigned_agent'],
      order: { priority: 'DESC', created_at: 'ASC' },
    });
  }

  async findByProject(projectId: string) {
    return this.repo
      .createQueryBuilder('task')
      .innerJoin('task.feature', 'feature')
      .innerJoin('feature.epic', 'epic')
      .innerJoin('epic.sprint', 'sprint')
      .innerJoin('sprint.mvp', 'mvp')
      .where('mvp.project_id = :projectId', { projectId })
      .leftJoinAndSelect('task.assigned_agent', 'agent')
      .leftJoinAndSelect('task.subtasks', 'subtask')
      .orderBy('task.priority', 'DESC')
      .addOrderBy('task.created_at', 'ASC')
      .getMany();
  }

  /** All tasks assigned to a given actor across every project. */
  findByAssignee(actorId: string) {
    return this.repo.find({
      where: { assigned_agent_id: actorId },
      relations: ['assigned_agent'],
      order: { priority: 'DESC', created_at: 'ASC' },
    });
  }

  async findOne(id: string) {
    const task = await this.repo.findOne({
      where: { id },
      relations: ['assigned_agent', 'subtasks'],
    });
    if (!task) throw new NotFoundException(`Task ${id} not found`);
    return task;
  }

  async createForFeature(featureId: string, dto: CreateTaskDto) {
    this.logger.log(`Creating task "${dto.title}" for feature ${featureId.slice(0, 8)}`);
    const task = await this.repo.save(
      this.repo.create({ ...dto, feature_id: featureId }),
    );
    this.logger.log(`Task created: ${task.id.slice(0, 8)} "${task.title}"`);
    return task;
  }

  createSubtask(parentId: string, dto: CreateTaskDto) {
    this.logger.log(`Creating subtask "${dto.title}" under parent ${parentId.slice(0, 8)}`);
    return this.repo.manager.transaction(async (manager) => {
      const parent = await manager.findOne(Task, { where: { id: parentId } });
      if (!parent) throw new NotFoundException(`Task ${parentId} not found`);
      const subtask = await manager.save(
        manager.create(Task, {
          ...dto,
          feature_id: parent.feature_id,
          parent_task_id: parentId,
        }),
      );
      this.logger.log(`Subtask created: ${subtask.id.slice(0, 8)} under ${parentId.slice(0, 8)}`);
      return subtask;
    });
  }

  async update(id: string, dto: UpdateTaskDto) {
    this.logger.log(`Updating task ${id.slice(0, 8)}: ${JSON.stringify(Object.keys(dto))}`);
    const task = await this.findOne(id);

    const isNewAssignment =
      dto.assigned_agent_id &&
      dto.assigned_agent_id !== task.assigned_agent_id;

    const isCancelling = dto.status === 'cancelled' && task.status !== 'cancelled';

    // Auto-assign sets status
    if (dto.assigned_agent_id && !dto.status && task.status === 'backlog') {
      dto.status = 'assigned';
      this.logger.log(`Task ${id.slice(0, 8)}: auto-transitioning backlog -> assigned`);
    }

    // Validate status transition
    if (dto.status && dto.status !== task.status) {
      const allowed = VALID_TRANSITIONS[task.status] ?? [];
      if (!allowed.includes(dto.status)) {
        this.logger.warn(`Task ${id.slice(0, 8)}: invalid transition ${task.status} -> ${dto.status}`);
        throw new BadRequestException(
          `Cannot transition from '${task.status}' to '${dto.status}'`,
        );
      }
      this.logger.log(`Task ${id.slice(0, 8)}: status ${task.status} -> ${dto.status}`);
    }

    if (isNewAssignment) {
      this.logger.log(`Task ${id.slice(0, 8)}: agent assigned ${dto.assigned_agent_id!.slice(0, 8)}`);
    }

    Object.assign(task, dto);
    const saved = await this.repo.save(task);

    // When a task is cancelled, cancel its outstanding wake events too.
    // Otherwise queued/in-flight wakes will keep firing for a task the user
    // explicitly killed. Marks pending/processing wakes as 'skipped'.
    if (isCancelling) {
      const result = await this.wakeEventRepo
        .createQueryBuilder()
        .update()
        .set({ status: 'skipped' })
        .where('task_id = :taskId', { taskId: id })
        .andWhere('status IN (:...statuses)', { statuses: ['pending', 'processing'] })
        .execute();
      if (result.affected && result.affected > 0) {
        this.logger.log(
          `Task ${id.slice(0, 8)}: cancelled ${result.affected} pending/processing wake events`,
        );
      }
    }

    // Create wake event when agent is assigned (dedup: skip if one already pending/processing)
    if (isNewAssignment && dto.assigned_agent_id) {
      const projectId = await this.resolveProjectId(id);
      if (projectId) {
        // Auto-transition the project to `active` on any new assignment.
        // Once someone (master or human) is handing work to a dev, the
        // `analysing` / `paused` gates should drop so the runner will wake
        // the assignee. Master-only states no longer apply.
        await this.projectRepo
          .createQueryBuilder()
          .update()
          .set({ status: 'active' })
          .where('id = :projectId', { projectId })
          .andWhere('status IN (:...gated)', { gated: ['analysing', 'paused'] })
          .execute()
          .then((result) => {
            if (result.affected && result.affected > 0) {
              this.logger.log(
                `Project ${projectId.slice(0, 8)}: auto-transitioned to active (task ${id.slice(0, 8)} assigned)`,
              );
            }
          });

        const recentCutoff = new Date(Date.now() - 60_000);
        const existing = await this.wakeEventRepo.findOne({
          where: [
            { agent_id: dto.assigned_agent_id, task_id: id, status: 'pending' },
            { agent_id: dto.assigned_agent_id, task_id: id, status: 'processing' },
            { agent_id: dto.assigned_agent_id, task_id: id, status: 'done', created_at: MoreThan(recentCutoff) },
          ],
        });
        if (!existing) {
          await this.wakeEventRepo.save(
            this.wakeEventRepo.create({
              agent_id: dto.assigned_agent_id,
              project_id: projectId,
              task_id: id,
              triggered_by: 'assignment',
              status: 'pending',
            }),
          );
          this.logger.log(`Task ${id.slice(0, 8)}: wake event created (assignment) for agent ${dto.assigned_agent_id.slice(0, 8)}`);
        } else {
          this.logger.log(`Task ${id.slice(0, 8)}: wake event dedup hit for agent ${dto.assigned_agent_id.slice(0, 8)}`);
        }
      }
    }

    return saved;
  }

  async remove(id: string) {
    const task = await this.findOne(id);
    await this.repo.remove(task);
    return { deleted: true };
  }

  private async resolveProjectId(taskId: string): Promise<string | null> {
    const result = await this.repo
      .createQueryBuilder('task')
      .innerJoin('task.feature', 'feature')
      .innerJoin('feature.epic', 'epic')
      .innerJoin('epic.sprint', 'sprint')
      .innerJoin('sprint.mvp', 'mvp')
      .select('mvp.project_id', 'project_id')
      .where('task.id = :taskId', { taskId })
      .getRawOne();
    return result?.project_id ?? null;
  }
}
