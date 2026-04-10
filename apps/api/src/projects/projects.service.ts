import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { rmSync, existsSync } from 'fs';
import { Project } from './project.entity.js';
import { CreateProjectDto } from './dto/create-project.dto.js';
import { UpdateProjectDto } from './dto/update-project.dto.js';
import { WorkspaceSetupService } from './workspace-setup.service.js';

const VALID_TRANSITIONS: Record<string, string[]> = {
  analysing: ['paused', 'active'],
  paused: ['analysing', 'active'],
  active: ['paused', 'completed'],
  completed: [],
};

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    @InjectRepository(Project)
    private readonly repo: Repository<Project>,
    private readonly workspaceSetup: WorkspaceSetupService,
  ) {}

  findAll() {
    return this.repo.find({ order: { created_at: 'DESC' } });
  }

  async findOne(id: string) {
    const project = await this.repo.findOne({ where: { id } });
    if (!project) throw new NotFoundException(`Project ${id} not found`);
    return project;
  }

  async create(dto: CreateProjectDto) {
    const customPath = dto.repo_path;
    // Clear repo_path so we always run setup (even with custom path)
    const createData = { ...dto };
    delete createData.repo_path;
    delete createData.worktree_path;
    delete createData.claude_md_path;

    const project = await this.repo.save(this.repo.create(createData));

    // Set up workspace on disk
    const paths = this.workspaceSetup.setup(project.name, project.id, customPath);
    project.repo_path = paths.repo_path;
    project.worktree_path = paths.worktree_path;
    project.claude_md_path = paths.claude_md_path;
    await this.repo.save(project);

    return project;
  }

  async update(id: string, dto: UpdateProjectDto) {
    const project = await this.findOne(id);
    if (dto.status && dto.status !== project.status) {
      const allowed = VALID_TRANSITIONS[project.status] ?? [];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(
          `Cannot transition from '${project.status}' to '${dto.status}'`,
        );
      }
    }
    Object.assign(project, dto);
    return this.repo.save(project);
  }

  async remove(id: string, deleteFiles = false) {
    const project = await this.findOne(id);
    const repoPath = project.repo_path;

    // Delete DB row first — this cascades to mvps/sprints/epics/features/tasks/
    // comments/wake_events/memory_files via ON DELETE CASCADE.
    await this.repo.remove(project);

    let filesDeleted = false;
    if (deleteFiles && repoPath && existsSync(repoPath)) {
      try {
        rmSync(repoPath, { recursive: true, force: true });
        this.logger.log(`Deleted workspace at ${repoPath}`);
        filesDeleted = true;
      } catch (err) {
        // DB delete already succeeded — surface the disk failure but don't undo
        this.logger.error(
          `Failed to delete workspace at ${repoPath}: ${(err as Error).message}`,
        );
        throw new BadRequestException(
          `Project deleted from database, but failed to delete workspace files: ${(err as Error).message}`,
        );
      }
    }

    return { deleted: true, files_deleted: filesDeleted };
  }
}
