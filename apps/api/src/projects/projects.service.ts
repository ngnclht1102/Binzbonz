import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { rmSync, existsSync } from 'fs';
import { resolve } from 'path';
import { Project } from './project.entity.js';
import { AgentProjectSession } from '../agent-project-sessions/agent-project-session.entity.js';
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
    @InjectRepository(AgentProjectSession)
    private readonly sessionRepo: Repository<AgentProjectSession>,
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
    const importPath = dto.import_path?.trim();
    const customPath = dto.repo_path?.trim();

    if (importPath && customPath) {
      throw new BadRequestException(
        'Provide either import_path (for importing) or repo_path (for a new project) — not both',
      );
    }

    // Validation for imports: the path must exist, be a directory, be
    // writable, and not already be claimed by another project.
    let isImport = false;
    let resolvedPath: string | undefined = customPath;
    if (importPath) {
      const err = this.workspaceSetup.validateImportPath(importPath);
      if (err) throw new BadRequestException(err);

      // Reject if another project already points at this path. Normalise
      // with Node's path.resolve so trailing slashes and `./` don't hide
      // a collision.
      const normalised = resolve(importPath);
      const clash = await this.repo.findOne({ where: { repo_path: normalised } });
      if (clash) {
        throw new BadRequestException(
          `import_path is already used by project "${clash.name}" (${clash.id})`,
        );
      }
      isImport = true;
      resolvedPath = normalised;
    }

    // Strip workspace-managed fields from the create payload — setup()
    // fills them in below.
    const createData = { ...dto };
    delete createData.repo_path;
    delete createData.worktree_path;
    delete createData.claude_md_path;
    delete createData.import_path;

    const project = await this.repo.save(this.repo.create(createData));

    try {
      const paths = this.workspaceSetup.setup({
        name: project.name,
        id: project.id,
        customPath: resolvedPath,
        isImport,
      });
      project.repo_path = paths.repo_path;
      project.worktree_path = paths.worktree_path;
      project.claude_md_path = paths.claude_md_path;
      await this.repo.save(project);
    } catch (err) {
      // Workspace setup blew up — roll back the DB row so the user isn't
      // left with a dangling "project" that has no disk footprint.
      await this.repo.remove(project).catch(() => undefined);
      throw new BadRequestException(
        `Workspace setup failed: ${(err as Error).message}`,
      );
    }

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

    // Explicitly drop agent_project_session rows for this project FIRST,
    // including the OpenAI message_history jsonb. The entity FK already has
    // ON DELETE CASCADE, but TypeORM `synchronize: true` is unreliable about
    // installing FK constraints on existing tables — this explicit delete
    // makes the cleanup deterministic regardless of schema state.
    const sessionDelete = await this.sessionRepo.delete({ project_id: id });
    if (sessionDelete.affected && sessionDelete.affected > 0) {
      this.logger.log(
        `Deleted ${sessionDelete.affected} agent_project_session rows (incl. OpenAI message history) for project ${id.slice(0, 8)}`,
      );
    }

    // Delete DB row — this cascades to mvps/sprints/epics/features/tasks/
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
