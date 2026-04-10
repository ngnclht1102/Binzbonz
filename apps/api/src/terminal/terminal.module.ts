import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Actor } from '../actors/actor.entity.js';
import { Project } from '../projects/project.entity.js';
import { TerminalGateway } from './terminal.gateway.js';

@Module({
  imports: [TypeOrmModule.forFeature([Actor, Project])],
  providers: [TerminalGateway],
})
export class TerminalModule {}
