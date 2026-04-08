import { Controller, Sse, MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { EventsGateway } from './events.gateway.js';

@Controller('events')
export class EventsController {
  constructor(private readonly gateway: EventsGateway) {}

  @Sse('stream')
  stream(): Observable<MessageEvent> {
    return this.gateway.notifications$.pipe(
      map((notification) => ({
        type: notification.channel,
        data: notification.payload,
      })),
    );
  }
}
