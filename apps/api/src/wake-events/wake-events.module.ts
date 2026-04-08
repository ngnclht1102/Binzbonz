import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WakeEvent } from './wake-event.entity.js';
import { WakeEventsController } from './wake-events.controller.js';
import { WakeEventsService } from './wake-events.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([WakeEvent])],
  controllers: [WakeEventsController],
  providers: [WakeEventsService],
  exports: [WakeEventsService, TypeOrmModule],
})
export class WakeEventsModule {}
