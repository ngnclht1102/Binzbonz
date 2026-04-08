import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Actor } from '../actors/actor.entity.js';

const SEED_ACTORS = [
  { name: 'ctbaceo', type: 'agent', role: 'ctbaceo', status: 'idle' },
  { name: 'dev-1', type: 'agent', role: 'developer', status: 'idle' },
  { name: 'dev-2', type: 'agent', role: 'developer', status: 'idle' },
  { name: 'dev-3', type: 'agent', role: 'developer', status: 'idle' },
  { name: 'dev-4', type: 'agent', role: 'developer', status: 'idle' },
  { name: 'dev-5', type: 'agent', role: 'developer', status: 'idle' },
  { name: 'dev-6', type: 'agent', role: 'developer', status: 'idle' },
  { name: 'brian', type: 'human', role: null, status: 'idle' },
];

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
  }
}
