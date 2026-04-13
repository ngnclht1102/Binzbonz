import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from './project.entity.js';
import { AgentProjectSession } from '../agent-project-sessions/agent-project-session.entity.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectFilesController } from './project-files.controller.js';
import { ProjectsService } from './projects.service.js';
import { WorkspaceSetupService } from './workspace-setup.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Project, AgentProjectSession])],
  controllers: [ProjectsController, ProjectFilesController],
  providers: [ProjectsService, WorkspaceSetupService],
  exports: [ProjectsService, TypeOrmModule],
})
export class ProjectsModule {}
