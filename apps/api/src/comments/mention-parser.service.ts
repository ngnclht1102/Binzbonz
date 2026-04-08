import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Actor } from '../actors/actor.entity.js';
import { WakeEvent } from '../wake-events/wake-event.entity.js';

@Injectable()
export class MentionParserService {
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
    if (names.size === 0) return [];

    const events: WakeEvent[] = [];
    for (const name of names) {
      const actor = await this.actorRepo.findOne({
        where: { name, type: 'agent' },
      });
      if (!actor) continue;

      // Dedup: skip if already pending/processing for this agent+task
      if (taskId) {
        const existing = await this.wakeEventRepo.findOne({
          where: [
            { agent_id: actor.id, task_id: taskId, status: 'pending' },
            { agent_id: actor.id, task_id: taskId, status: 'processing' },
          ],
        });
        if (existing) continue;
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
      events.push(event);
    }
    return events;
  }
}
