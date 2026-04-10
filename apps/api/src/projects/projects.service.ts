import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

  async remove(id: string) {
    const project = await this.findOne(id);
    await this.repo.remove(project);
    return { deleted: true };
  }
}
