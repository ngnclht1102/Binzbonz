import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Task } from './task.entity.js';
import { WakeEvent } from '../wake-events/wake-event.entity.js';
import { Project } from '../projects/project.entity.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Task, WakeEvent, Project])],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService, TypeOrmModule],
})
export class TasksModule {}
