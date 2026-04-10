import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentProjectSession } from './agent-project-session.entity.js';
import { AgentProjectSessionsController } from './agent-project-sessions.controller.js';
import { AgentProjectSessionsService } from './agent-project-sessions.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([AgentProjectSession])],
  controllers: [AgentProjectSessionsController],
  providers: [AgentProjectSessionsService],
  exports: [AgentProjectSessionsService, TypeOrmModule],
})
export class AgentProjectSessionsModule {}
