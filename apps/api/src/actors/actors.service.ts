import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Actor } from './actor.entity.js';
import { CreateActorDto } from './dto/create-actor.dto.js';
import { UpdateActorDto } from './dto/update-actor.dto.js';

@Injectable()
export class ActorsService {
  constructor(
    @InjectRepository(Actor)
    private readonly repo: Repository<Actor>,
  ) {}

  findAll(filters: { type?: string; role?: string; status?: string }) {
    const where: Record<string, string> = {};
    if (filters.type) where.type = filters.type;
    if (filters.role) where.role = filters.role;
    if (filters.status) where.status = filters.status;
    return this.repo.find({ where, order: { name: 'ASC' } });
  }

  async findOne(id: string) {
    const actor = await this.repo.findOne({ where: { id } });
    if (!actor) throw new NotFoundException(`Actor ${id} not found`);
    return actor;
  }

  create(dto: CreateActorDto) {
    return this.repo.save(this.repo.create(dto));
  }

  async update(id: string, dto: UpdateActorDto) {
    const actor = await this.findOne(id);
    Object.assign(actor, dto);
    return this.repo.save(actor);
  }

  async remove(id: string) {
    const actor = await this.findOne(id);
    await this.repo.remove(actor);
    return { deleted: true };
  }
}
