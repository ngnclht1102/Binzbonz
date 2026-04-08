import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { MemoryFile } from './memory-file.entity.js';

@Injectable()
export class MemoryService {
  constructor(
    @InjectRepository(MemoryFile)
    private readonly repo: Repository<MemoryFile>,
  ) {}

  findByProject(projectId: string) {
    return this.repo.find({
      where: { project_id: projectId },
      order: { last_updated_at: 'DESC' },
    });
  }

  findChangedSince(projectId: string, since: string) {
    return this.repo.find({
      where: {
        project_id: projectId,
        last_updated_at: MoreThan(new Date(since)),
      },
      order: { last_updated_at: 'DESC' },
    });
  }

  create(
    projectId: string,
    dto: {
      file_path: string;
      last_updated_by?: string;
      git_commit?: string;
    },
  ) {
    return this.repo.save(
      this.repo.create({
        project_id: projectId,
        file_path: dto.file_path,
        last_updated_at: new Date(),
        last_updated_by: dto.last_updated_by ?? null,
        git_commit: dto.git_commit ?? null,
      }),
    );
  }

  async update(
    id: string,
    dto: {
      last_updated_by?: string;
      git_commit?: string;
    },
  ) {
    const file = await this.repo.findOne({ where: { id } });
    if (!file) throw new NotFoundException(`MemoryFile ${id} not found`);
    file.last_updated_at = new Date();
    if (dto.last_updated_by) file.last_updated_by = dto.last_updated_by;
    if (dto.git_commit) file.git_commit = dto.git_commit;
    return this.repo.save(file);
  }
}
