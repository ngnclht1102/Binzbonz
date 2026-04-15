import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Actor } from '../actors/actor.entity.js';

const SEED_ACTORS = [
  { name: 'master', type: 'agent', role: 'master', status: 'idle' },
  { name: 'dev-1', type: 'agent', role: 'developer', status: 'idle' },
  { name: 'dev-2', type: 'agent', role: 'developer', status: 'idle' },
  { name: 'dev-3', type: 'agent', role: 'developer', status: 'idle' },
  { name: 'dev-4', type: 'agent', role: 'developer', status: 'idle' },
  { name: 'brian', type: 'human', role: null, status: 'idle' },
];

// One-shot cleanup: agents that used to be seeded but are no longer wanted.
// Removing them here cascades to their agent_project_session, comment, and
// wake_event rows; tasks assigned/created by them survive with NULL refs.
const REMOVED_SEED_ACTORS = ['dev-5', 'dev-6'];

@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @InjectRepository(Actor)
    private readonly actorRepo: Repository<Actor>,
  ) {}

  async onModuleInit(): Promise<void> {
    let created = 0;
    for (const seed of SEED_ACTORS) {
      const exists = await this.actorRepo.findOne({
        where: { name: seed.name },
      });
      if (!exists) {
        await this.actorRepo.save(this.actorRepo.create(seed));
        created++;
      }
    }
    if (created > 0) {
      this.logger.log(`Seeded ${created} actors`);
    } else {
      this.logger.log('All seed actors already exist');
    }

    // Drop any actors we no longer want seeded (idempotent — no-op once done).
    const stale = await this.actorRepo.find({
      where: { name: In(REMOVED_SEED_ACTORS) },
    });
    if (stale.length > 0) {
      await this.actorRepo.remove(stale);
      this.logger.log(`Removed stale seed actors: ${stale.map((a) => a.name).join(', ')}`);
    }
  }
}
