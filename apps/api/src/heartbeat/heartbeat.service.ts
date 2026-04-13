import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Actor } from '../actors/actor.entity.js';
import { WakeEventsService } from '../wake-events/wake-events.service.js';
import { ProjectsService } from '../projects/projects.service.js';

/**
 * Periodic heartbeat for OpenAI coordinator/dev agents.
 *
 * Runs every 30 seconds. Checks for the (single) actor with
 * heartbeat_enabled = true and, if its interval has elapsed since the last
 * tick, fans out one wake event per ACTIVE (non-completed) project in the
 * system. Session rows are created lazily by the runner on first wake.
 *
 * Single-bot constraint is enforced at the API layer (see ActorsService.setHeartbeat).
 * The cron is the resolution floor — actual interval can be at most 30s longer
 * than configured.
 */
@Injectable()
export class HeartbeatService {
  private readonly logger = new Logger(HeartbeatService.name);

  constructor(
    @InjectRepository(Actor)
    private readonly actorRepo: Repository<Actor>,
    private readonly wakeEvents: WakeEventsService,
    private readonly projects: ProjectsService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async tick(): Promise<void> {
    const bot = await this.actorRepo.findOne({
      where: { heartbeat_enabled: true },
    });
    if (!bot) return;

    const now = Date.now();
    // Treat null heartbeat_last_at as "fire on first tick" — clamp the
    // displayed elapsed value so the log doesn't show a huge nonsense number.
    const lastAt = bot.heartbeat_last_at?.getTime() ?? 0;
    const elapsedMs = lastAt === 0 ? bot.heartbeat_interval_seconds * 1000 : now - lastAt;
    const intervalMs = bot.heartbeat_interval_seconds * 1000;
    if (elapsedMs < intervalMs) return;

    // Quick gate: if there are no active projects to scan, do nothing.
    // We deliberately check BEFORE bumping heartbeat_last_at — that way as
    // soon as the user adds an active project, the next tick (within 30s)
    // fires immediately instead of waiting for a full interval.
    const allProjects = await this.projects.findAll();
    const activeProjects = allProjects.filter((p) => p.status !== 'completed');
    if (activeProjects.length === 0) {
      return;
    }

    this.logger.log(
      `Heartbeat tick for ${bot.name} (interval=${bot.heartbeat_interval_seconds}s, elapsed=${Math.round(elapsedMs / 1000)}s)`,
    );

    // Fan out to every active project. The agent runner will lazily create
    // the per-project session row on first wake via findOrCreate, so no
    // bootstrap is needed.
    let fired = 0;
    for (const p of activeProjects) {
      try {
        await this.wakeEvents.create({
          agent_id: bot.id,
          project_id: p.id,
          triggered_by: 'heartbeat',
        });
        fired++;
      } catch (err) {
        this.logger.warn(
          `Failed to create heartbeat wake for project ${p.id}: ${(err as Error).message}`,
        );
      }
    }

    bot.heartbeat_last_at = new Date();
    await this.actorRepo.save(bot);

    const skipped = allProjects.length - activeProjects.length;
    this.logger.log(
      `Heartbeat fired ${fired} wake events for ${bot.name} (${skipped} completed projects skipped)`,
    );
  }
}
