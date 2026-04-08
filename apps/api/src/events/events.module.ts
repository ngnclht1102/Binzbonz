import { Module, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EventsController } from './events.controller.js';
import { EventsGateway } from './events.gateway.js';
import { setupPgNotifyTriggers } from './pg-notify.setup.js';

@Module({
  controllers: [EventsController],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule implements OnModuleInit {
  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit() {
    await setupPgNotifyTriggers(this.dataSource);
  }
}
