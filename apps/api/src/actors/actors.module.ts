import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Actor } from './actor.entity.js';
import { AgentProjectSession } from '../agent-project-sessions/agent-project-session.entity.js';
import { ActorsController } from './actors.controller.js';
import { ActorsService } from './actors.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Actor, AgentProjectSession])],
  controllers: [ActorsController],
  providers: [ActorsService],
  exports: [ActorsService, TypeOrmModule],
})
export class ActorsModule {}
