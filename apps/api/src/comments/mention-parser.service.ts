import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { Actor } from '../actors/actor.entity.js';
import { WakeEvent } from '../wake-events/wake-event.entity.js';

@Injectable()
export class MentionParserService {
  private readonly logger = new Logger(MentionParserService.name);

  constructor(
    @InjectRepository(Actor)
    private readonly actorRepo: Repository<Actor>,
    @InjectRepository(WakeEvent)
    private readonly wakeEventRepo: Repository<WakeEvent>,
  ) {}

  async parseMentions(
    body: string,
    commentId: string,
    projectId: string,
    taskId?: string,
  ): Promise<WakeEvent[]> {
    const mentionPattern = /@([\w-]+)/g;
    const names = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = mentionPattern.exec(body)) !== null) {
      names.add(match[1]);
    }
    if (names.size === 0) {
      this.logger.debug(`No mentions found in comment ${commentId.slice(0, 8)}`);
      return [];
    }
    this.logger.log(`Mentions found in comment ${commentId.slice(0, 8)}: ${[...names].join(', ')}`);

    const events: WakeEvent[] = [];
    for (const name of names) {
      const actor = await this.actorRepo.findOne({
        where: { name, type: 'agent' },
      });
      if (!actor) {
        this.logger.debug(`Mention @${name}: no matching agent found`);
        continue;
      }

      // Dedup: skip if already pending/processing, or completed within last 60s
      if (taskId) {
        const recentCutoff = new Date(Date.now() - 60_000);
        const existing = await this.wakeEventRepo.findOne({
          where: [
            { agent_id: actor.id, task_id: taskId, status: 'pending' },
            { agent_id: actor.id, task_id: taskId, status: 'processing' },
            { agent_id: actor.id, task_id: taskId, status: 'done', created_at: MoreThan(recentCutoff) },
          ],
        });
        if (existing) {
          this.logger.log(`Mention @${name}: dedup hit — wake event ${existing.status} for task ${taskId.slice(0, 8)} (skip)`);
          continue;
        }
      }

      const event = await this.wakeEventRepo.save(
        this.wakeEventRepo.create({
          agent_id: actor.id,
          project_id: projectId,
          task_id: taskId ?? null,
          triggered_by: 'mention',
          comment_id: commentId,
          status: 'pending',
        }),
      );
      this.logger.log(`Mention @${name}: wake event created ${event.id.slice(0, 8)} (mention) for agent ${actor.id.slice(0, 8)}`);
      events.push(event);
    }
    return events;
  }
}
