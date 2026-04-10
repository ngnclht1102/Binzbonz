import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { logToFile } from './file-logger.service.js';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    if (!req?.method) return next.handle();

    const { method, url, body } = req;
    const bodySummary = body && Object.keys(body).length > 0
      ? ` body_keys=[${Object.keys(body).join(',')}]`
      : '';

    const msg = `--> ${method} ${url}${bodySummary}`;
    this.logger.log(msg);
    logToFile('info', 'HTTP', msg);

    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const ms = Date.now() - start;
          const msg = `<-- ${method} ${url} 200 ${ms}ms`;
          this.logger.log(msg);
          logToFile('info', 'HTTP', msg);
        },
        error: (err) => {
          const ms = Date.now() - start;
          const status = err?.status ?? err?.getStatus?.() ?? 500;
          const msg = `<-- ${method} ${url} ${status} ${ms}ms - ${err.message ?? 'error'}`;
          this.logger.warn(msg);
          logToFile('warn', 'HTTP', msg);
        },
      }),
    );
  }
}
