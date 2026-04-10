import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Subject } from 'rxjs';
import { Client } from 'pg';
import { EmbeddedPostgresService } from '../database/embedded-postgres.service.js';

export interface PgNotification {
  channel: string;
  payload: string;
}

@Injectable()
export class EventsGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventsGateway.name);
  private client: Client | null = null;
  readonly notifications$ = new Subject<PgNotification>();

  constructor(private readonly epService: EmbeddedPostgresService) {}

  async onModuleInit() {
    const connStr = this.epService.getConnectionString();
    if (!connStr) return;

    this.client = new Client({ connectionString: connStr });
    await this.client.connect();

    this.client.on('notification', (msg) => {
      if (msg.channel && msg.payload) {
        this.logger.debug(`pg_notify received: channel=${msg.channel} payload=${msg.payload.slice(0, 100)}`);
        this.notifications$.next({
          channel: msg.channel,
          payload: msg.payload,
        });
      }
    });

    await this.client.query('LISTEN comment_change');
    await this.client.query('LISTEN task_change');
    await this.client.query('LISTEN wake_event_change');
    this.logger.log('Listening for pg_notify on comment_change, task_change, wake_event_change');
  }

  async onModuleDestroy() {
    this.notifications$.complete();
    if (this.client) {
      await this.client.end().catch(() => {});
    }
  }
}
