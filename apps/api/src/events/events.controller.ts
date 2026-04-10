import { Controller, Logger, Sse, MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map, tap, finalize } from 'rxjs/operators';
import { EventsGateway } from './events.gateway.js';

@Controller('events')
export class EventsController {
  private readonly logger = new Logger(EventsController.name);
  private clientCount = 0;

  constructor(private readonly gateway: EventsGateway) {}

  @Sse('stream')
  stream(): Observable<MessageEvent> {
    this.clientCount++;
    this.logger.log(`SSE client connected (total: ${this.clientCount})`);

    return this.gateway.notifications$.pipe(
      tap((notification) => {
        this.logger.debug(`SSE emit: ${notification.channel}`);
      }),
      map((notification) => ({
        type: notification.channel,
        data: notification.payload,
      })),
      finalize(() => {
        this.clientCount--;
        this.logger.log(`SSE client disconnected (total: ${this.clientCount})`);
      }),
    );
  }
}
