import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Mvp } from './mvp.entity.js';
import { Sprint } from './sprint.entity.js';
import { Epic } from './epic.entity.js';
import { Feature } from './feature.entity.js';

@Injectable()
export class HierarchyService {
  constructor(
    @InjectRepository(Mvp) private readonly mvpRepo: Repository<Mvp>,
    @InjectRepository(Sprint) private readonly sprintRepo: Repository<Sprint>,
    @InjectRepository(Epic) private readonly epicRepo: Repository<Epic>,
    @InjectRepository(Feature) private readonly featureRepo: Repository<Feature>,
  ) {}

  // --- MVPs ---
  findMvps(projectId: string) {
    return this.mvpRepo.find({ where: { project_id: projectId }, order: { created_at: 'ASC' } });
  }
  async createMvp(projectId: string, dto: Partial<Mvp>) {
    return this.mvpRepo.save(this.mvpRepo.create({ ...dto, project_id: projectId }));
  }
  async updateMvp(id: string, dto: Partial<Mvp>) {
    const mvp = await this.mvpRepo.findOne({ where: { id } });
    if (!mvp) throw new NotFoundException(`MVP ${id} not found`);
    Object.assign(mvp, dto);
    return this.mvpRepo.save(mvp);
  }
  async removeMvp(id: string) {
    const mvp = await this.mvpRepo.findOne({ where: { id } });
    if (!mvp) throw new NotFoundException(`MVP ${id} not found`);
    await this.mvpRepo.remove(mvp);
    return { deleted: true };
  }

  // --- Sprints ---
  findSprints(mvpId: string) {
    return this.sprintRepo.find({ where: { mvp_id: mvpId }, order: { created_at: 'ASC' } });
  }
  async createSprint(mvpId: string, dto: Partial<Sprint>) {
    return this.sprintRepo.save(this.sprintRepo.create({ ...dto, mvp_id: mvpId }));
  }
  async updateSprint(id: string, dto: Partial<Sprint>) {
    const sprint = await this.sprintRepo.findOne({ where: { id } });
    if (!sprint) throw new NotFoundException(`Sprint ${id} not found`);
    Object.assign(sprint, dto);
    return this.sprintRepo.save(sprint);
  }
  async removeSprint(id: string) {
    const sprint = await this.sprintRepo.findOne({ where: { id } });
    if (!sprint) throw new NotFoundException(`Sprint ${id} not found`);
    await this.sprintRepo.remove(sprint);
    return { deleted: true };
  }

  // --- Epics ---
  findEpics(sprintId: string) {
    return this.epicRepo.find({ where: { sprint_id: sprintId }, order: { created_at: 'ASC' } });
  }
  async createEpic(sprintId: string, dto: Partial<Epic>) {
    return this.epicRepo.save(this.epicRepo.create({ ...dto, sprint_id: sprintId }));
  }
  async updateEpic(id: string, dto: Partial<Epic>) {
    const epic = await this.epicRepo.findOne({ where: { id } });
    if (!epic) throw new NotFoundException(`Epic ${id} not found`);
    Object.assign(epic, dto);
    return this.epicRepo.save(epic);
  }
  async removeEpic(id: string) {
    const epic = await this.epicRepo.findOne({ where: { id } });
    if (!epic) throw new NotFoundException(`Epic ${id} not found`);
    await this.epicRepo.remove(epic);
    return { deleted: true };
  }

  // --- Features ---
  findFeatures(epicId: string) {
    return this.featureRepo.find({ where: { epic_id: epicId }, order: { created_at: 'ASC' } });
  }
  async createFeature(epicId: string, dto: Partial<Feature>) {
    return this.featureRepo.save(this.featureRepo.create({ ...dto, epic_id: epicId }));
  }
  async updateFeature(id: string, dto: Partial<Feature>) {
    const feature = await this.featureRepo.findOne({ where: { id } });
    if (!feature) throw new NotFoundException(`Feature ${id} not found`);
    Object.assign(feature, dto);
    return this.featureRepo.save(feature);
  }
  async removeFeature(id: string) {
    const feature = await this.featureRepo.findOne({ where: { id } });
    if (!feature) throw new NotFoundException(`Feature ${id} not found`);
    await this.featureRepo.remove(feature);
    return { deleted: true };
  }
}
