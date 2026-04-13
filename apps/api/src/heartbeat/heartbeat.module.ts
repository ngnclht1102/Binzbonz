import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Actor } from '../actors/actor.entity.js';
import { WakeEventsModule } from '../wake-events/wake-events.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { HeartbeatService } from './heartbeat.service.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([Actor]),
    WakeEventsModule,
    ProjectsModule,
  ],
  providers: [HeartbeatService],
})
export class HeartbeatModule {}
