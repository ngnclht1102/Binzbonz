import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WakeEvent } from './wake-event.entity.js';

@Injectable()
export class WakeEventsService {
  constructor(
    @InjectRepository(WakeEvent)
    private readonly repo: Repository<WakeEvent>,
  ) {}

  findAll(filters: { status?: string; agent_id?: string }) {
    const where: Record<string, string> = {};
    if (filters.status) where.status = filters.status;
    if (filters.agent_id) where.agent_id = filters.agent_id;
    return this.repo.find({
      where,
      relations: ['agent', 'project'],
      order: { created_at: 'ASC' },
    });
  }

  async findOne(id: string) {
    const event = await this.repo.findOne({
      where: { id },
      relations: ['agent', 'project', 'comment'],
    });
    if (!event) throw new NotFoundException(`WakeEvent ${id} not found`);
    return event;
  }

  create(dto: {
    agent_id: string;
    project_id: string;
    triggered_by: string;
    comment_id?: string;
  }) {
    return this.repo.save(this.repo.create({ ...dto, status: 'pending' }));
  }

  async update(id: string, dto: { status: string }) {
    const event = await this.findOne(id);
    event.status = dto.status;
    return this.repo.save(event);
  }
}
