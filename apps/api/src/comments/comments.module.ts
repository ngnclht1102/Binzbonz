import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Comment } from './comment.entity.js';
import { ProjectComment } from './project-comment.entity.js';
import { Actor } from '../actors/actor.entity.js';
import { WakeEvent } from '../wake-events/wake-event.entity.js';
import { Task } from '../tasks/task.entity.js';
import { CommentsController } from './comments.controller.js';
import { CommentsService } from './comments.service.js';
import { MentionParserService } from './mention-parser.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Comment, ProjectComment, Actor, WakeEvent, Task]),
  ],
  controllers: [CommentsController],
  providers: [CommentsService, MentionParserService],
  exports: [CommentsService],
})
export class CommentsModule {}
