import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentProjectSession } from './agent-project-session.entity.js';
import { AgentProjectSessionsController } from './agent-project-sessions.controller.js';
import { AgentProjectSessionsService } from './agent-project-sessions.service.js';
import { WakeEventsModule } from '../wake-events/wake-events.module.js';
import { ActorsModule } from '../actors/actors.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([AgentProjectSession]),
    WakeEventsModule,
    ActorsModule,
  ],
  controllers: [AgentProjectSessionsController],
  providers: [AgentProjectSessionsService],
  exports: [AgentProjectSessionsService, TypeOrmModule],
})
export class AgentProjectSessionsModule {}
