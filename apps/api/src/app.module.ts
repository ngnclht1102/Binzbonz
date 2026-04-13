import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { DatabaseModule } from './database/database.module.js';
import { ActorsModule } from './actors/actors.module.js';
import { AgentProjectSessionsModule } from './agent-project-sessions/agent-project-sessions.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { HierarchyModule } from './hierarchy/hierarchy.module.js';
import { TasksModule } from './tasks/tasks.module.js';
import { CommentsModule } from './comments/comments.module.js';
import { WakeEventsModule } from './wake-events/wake-events.module.js';
import { MemoryModule } from './memory/memory.module.js';
import { SeedModule } from './seed/seed.module.js';
import { EventsModule } from './events/events.module.js';
import { TerminalModule } from './terminal/terminal.module.js';
import { FilesystemModule } from './filesystem/filesystem.module.js';
import { HeartbeatModule } from './heartbeat/heartbeat.module.js';

@Module({
  imports: [
    DatabaseModule,
    ActorsModule,
    AgentProjectSessionsModule,
    ProjectsModule,
    HierarchyModule,
    TasksModule,
    CommentsModule,
    WakeEventsModule,
    MemoryModule,
    SeedModule,
    EventsModule,
    TerminalModule,
    FilesystemModule,
    HeartbeatModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
