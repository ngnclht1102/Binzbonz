import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Actor } from '../actors/actor.entity.js';
import { Project } from '../projects/project.entity.js';
import { AgentProjectSessionsModule } from '../agent-project-sessions/agent-project-sessions.module.js';
import { TerminalGateway } from './terminal.gateway.js';

@Module({
  imports: [TypeOrmModule.forFeature([Actor, Project]), AgentProjectSessionsModule],
  providers: [TerminalGateway],
})
export class TerminalModule {}
