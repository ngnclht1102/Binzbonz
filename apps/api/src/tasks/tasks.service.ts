import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task } from './task.entity.js';
import { WakeEvent } from '../wake-events/wake-event.entity.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { UpdateTaskDto } from './dto/update-task.dto.js';

const VALID_TRANSITIONS: Record<string, string[]> = {
  backlog: ['assigned', 'cancelled'],
  assigned: ['in_progress', 'backlog', 'cancelled'],
  in_progress: ['blocked', 'review_request', 'done', 'cancelled'],
  blocked: ['in_progress', 'cancelled'],
  review_request: ['in_progress', 'done', 'cancelled'],
  done: ['backlog'],
  cancelled: ['backlog'],
};

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task)
    private readonly repo: Repository<Task>,
    @InjectRepository(WakeEvent)
    private readonly wakeEventRepo: Repository<WakeEvent>,
  ) {}

  findByFeature(featureId: string) {
    return this.repo.find({
      where: { feature_id: featureId, parent_task_id: undefined },
      relations: ['assigned_agent', 'subtasks'],
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

  async findOne(id: string) {
    const task = await this.repo.findOne({
      where: { id },
      relations: ['assigned_agent', 'subtasks'],
    });
    if (!task) throw new NotFoundException(`Task ${id} not found`);
    return task;
  }

  createForFeature(featureId: string, dto: CreateTaskDto) {
    return this.repo.save(
      this.repo.create({ ...dto, feature_id: featureId }),
    );
  }

  createSubtask(parentId: string, dto: CreateTaskDto) {
    return this.repo.manager.transaction(async (manager) => {
      const parent = await manager.findOne(Task, { where: { id: parentId } });
      if (!parent) throw new NotFoundException(`Task ${parentId} not found`);
      return manager.save(
        manager.create(Task, {
          ...dto,
          feature_id: parent.feature_id,
          parent_task_id: parentId,
        }),
      );
    });
  }

  async update(id: string, dto: UpdateTaskDto) {
    const task = await this.findOne(id);

    const isNewAssignment =
      dto.assigned_agent_id &&
      dto.assigned_agent_id !== task.assigned_agent_id;

    // Auto-assign sets status
    if (dto.assigned_agent_id && !dto.status && task.status === 'backlog') {
      dto.status = 'assigned';
    }

    // Validate status transition
    if (dto.status && dto.status !== task.status) {
      const allowed = VALID_TRANSITIONS[task.status] ?? [];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(
          `Cannot transition from '${task.status}' to '${dto.status}'`,
        );
      }
    }

    Object.assign(task, dto);
    const saved = await this.repo.save(task);

    // Create wake event when agent is assigned (dedup: skip if one already pending/processing)
    if (isNewAssignment && dto.assigned_agent_id) {
      const projectId = await this.resolveProjectId(id);
      if (projectId) {
        const existing = await this.wakeEventRepo.findOne({
          where: [
            { agent_id: dto.assigned_agent_id, task_id: id, status: 'pending' },
            { agent_id: dto.assigned_agent_id, task_id: id, status: 'processing' },
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
