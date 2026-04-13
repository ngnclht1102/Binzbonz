import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Actor } from './actor.entity.js';
import { AgentProjectSession } from '../agent-project-sessions/agent-project-session.entity.js';
import { redactActor, redactActors } from './actor-redact.js';
import { CreateActorDto } from './dto/create-actor.dto.js';
import { UpdateActorDto } from './dto/update-actor.dto.js';
import { HeartbeatDto } from './dto/heartbeat.dto.js';
import { ProviderConfigDto } from './dto/provider-config.dto.js';

const OPENAPI_ROLES = new Set(['openapidev', 'openapicoor']);

@Injectable()
export class ActorsService {
  constructor(
    @InjectRepository(Actor)
    private readonly repo: Repository<Actor>,
    @InjectRepository(AgentProjectSession)
    private readonly sessionRepo: Repository<AgentProjectSession>,
  ) {}

  // ─── Public (redacted) lookups ────────────────────────────────────────

  async findAll(filters: { type?: string; role?: string; status?: string }) {
    const where: Record<string, string> = {};
    if (filters.type) where.type = filters.type;
    if (filters.role) where.role = filters.role;
    if (filters.status) where.status = filters.status;
    const rows = await this.repo.find({ where, order: { name: 'ASC' } });
    return redactActors(rows);
  }

  async findOne(id: string) {
    const actor = await this.findOneRaw(id);
    return redactActor(actor);
  }

  // ─── Internal (raw) lookups — for the runner / spawner only ──────────
  // Use sparingly. Never return the raw row over HTTP.

  async findOneRaw(id: string): Promise<Actor> {
    const actor = await this.repo.findOne({ where: { id } });
    if (!actor) throw new NotFoundException(`Actor ${id} not found`);
    return actor;
  }

  // ─── Mutations ────────────────────────────────────────────────────────

  async create(dto: CreateActorDto) {
    this.validateProviderFields(dto.role, dto);
    const created = await this.repo.save(this.repo.create(dto));
    return redactActor(created);
  }

  async update(id: string, dto: UpdateActorDto) {
    const actor = await this.findOneRaw(id);
    Object.assign(actor, dto);
    const saved = await this.repo.save(actor);
    return redactActor(saved);
  }

  async remove(id: string) {
    const actor = await this.findOneRaw(id);

    // Explicitly drop all agent_project_session rows (and the OpenAI
    // message_history they hold) BEFORE deleting the actor. The entity FK
    // already has ON DELETE CASCADE, but TypeORM `synchronize: true` is
    // unreliable about installing FK constraints on existing tables — this
    // explicit delete makes the cleanup deterministic regardless of schema.
    const sessionDelete = await this.sessionRepo.delete({ agent_id: id });
    if (sessionDelete.affected && sessionDelete.affected > 0) {
      // (no logger on this service yet, just keep it silent — the action
      // is logged at the HTTP layer anyway)
    }

    await this.repo.remove(actor);
    return { deleted: true, sessions_removed: sessionDelete.affected ?? 0 };
  }

  // ─── Heartbeat ────────────────────────────────────────────────────────

  async setHeartbeat(id: string, dto: HeartbeatDto) {
    const actor = await this.findOneRaw(id);

    // Only OpenAI agents can run heartbeats — Claude bots have no scheduler.
    if (dto.enabled && !OPENAPI_ROLES.has(actor.role ?? '')) {
      throw new BadRequestException(
        'Heartbeat can only be enabled for openapidev / openapicoor agents',
      );
    }

    // Single-bot constraint: only ONE actor in the system can have
    // heartbeat_enabled at a time. 409 Conflict if violated.
    if (dto.enabled) {
      const existing = await this.repo.findOne({
        where: { heartbeat_enabled: true, id: Not(id) },
      });
      if (existing) {
        throw new ConflictException(
          `Heartbeat is already enabled for "${existing.name}". Disable it there first.`,
        );
      }
    }

    actor.heartbeat_enabled = dto.enabled;
    if (dto.enabled && dto.interval_seconds !== undefined) {
      if (dto.interval_seconds < 30) {
        throw new BadRequestException('interval_seconds must be >= 30');
      }
      actor.heartbeat_interval_seconds = dto.interval_seconds;
    }
    if (!dto.enabled) {
      actor.heartbeat_last_at = null;
    }

    const saved = await this.repo.save(actor);
    return redactActor(saved);
  }

  // ─── Provider config (with optional verification) ────────────────────

  async updateProviderConfig(id: string, dto: ProviderConfigDto, verify = false) {
    const actor = await this.findOneRaw(id);
    if (!OPENAPI_ROLES.has(actor.role ?? '')) {
      throw new BadRequestException(
        'Provider config can only be updated on openapidev / openapicoor agents',
      );
    }

    if (dto.base_url !== undefined) actor.provider_base_url = dto.base_url;
    if (dto.model !== undefined) actor.provider_model = dto.model;
    if (dto.api_key !== undefined) actor.provider_api_key = dto.api_key;

    if (verify) {
      await this.testProviderConnection(
        actor.provider_base_url,
        actor.provider_api_key,
      );
    }

    const saved = await this.repo.save(actor);
    return redactActor(saved);
  }

  /**
   * Hit the provider's /models endpoint to verify the base URL + API key
   * combo. Throws if the call fails. Used by ?verify=true on
   * updateProviderConfig and by the standalone Test Connection endpoint.
   */
  async testProviderConnection(
    base_url: string | null,
    api_key: string | null,
  ): Promise<{ ok: true; models: string[] }> {
    if (!base_url || !api_key) {
      throw new BadRequestException('base_url and api_key are required');
    }
    const url = `${base_url.replace(/\/$/, '')}/models`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${api_key}` },
      });
    } catch (err) {
      throw new BadRequestException(
        `Could not reach provider: ${(err as Error).message}`,
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new BadRequestException('API key rejected by provider');
    }
    if (!res.ok) {
      throw new BadRequestException(
        `Provider returned HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`,
      );
    }
    const body = (await res.json()) as { data?: { id: string }[] };
    const models = (body.data ?? []).map((m) => m.id);
    return { ok: true, models };
  }

  // ─── Internal validation ─────────────────────────────────────────────

  private validateProviderFields(role: string | undefined, fields: {
    provider_base_url?: string;
    provider_model?: string;
    provider_api_key?: string;
  }) {
    const isOpenAI = OPENAPI_ROLES.has(role ?? '');
    if (isOpenAI) {
      if (!fields.provider_base_url || !fields.provider_model || !fields.provider_api_key) {
        throw new BadRequestException(
          'provider_base_url, provider_model and provider_api_key are required for openapidev / openapicoor roles',
        );
      }
    } else {
      if (fields.provider_base_url || fields.provider_model || fields.provider_api_key) {
        throw new BadRequestException(
          'provider_* fields are only valid for openapidev / openapicoor roles',
        );
      }
    }
  }
}
