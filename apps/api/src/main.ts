import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module.js';
import { LoggingInterceptor } from './logging.interceptor.js';
import { DualLogger } from './dual-logger.js';

async function bootstrap() {
  const dualLogger = new DualLogger();

  const app = await NestFactory.create(AppModule, {
    logger: dualLogger,
  });
  app.enableCors();
  app.useWebSocketAdapter(new WsAdapter(app));
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  app.useGlobalInterceptors(new LoggingInterceptor());

  const port = 3001;
  await app.listen(port);
  dualLogger.log(`API listening on http://localhost:${port}`, 'Bootstrap');
  dualLogger.log(`WebSocket terminal at ws://localhost:${port}/terminal`, 'Bootstrap');
}
bootstrap();
