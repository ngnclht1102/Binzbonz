import { LoggerService } from '@nestjs/common';
import { logToFile } from './file-logger.service.js';

/**
 * NestJS LoggerService that writes to both console and a log file.
 * Used as app.useLogger() so ALL NestJS log calls go to file automatically.
 */
export class DualLogger implements LoggerService {
  log(message: string, context?: string): void {
    const ctx = context ?? 'App';
    const line = `[${ctx}] ${message}`;
    process.stdout.write(`\x1b[32m[Nest]\x1b[0m ${new Date().toLocaleTimeString()} \x1b[32m    LOG\x1b[0m ${line}\n`);
    logToFile('info', ctx, message);
  }

  error(message: string, trace?: string, context?: string): void {
    const ctx = context ?? 'App';
    const line = `[${ctx}] ${message}`;
    process.stderr.write(`\x1b[31m[Nest]\x1b[0m ${new Date().toLocaleTimeString()} \x1b[31m  ERROR\x1b[0m ${line}\n`);
    if (trace) process.stderr.write(`${trace}\n`);
    logToFile('error', ctx, `${message}${trace ? ` | ${trace.split('\n')[0]}` : ''}`);
  }

  warn(message: string, context?: string): void {
    const ctx = context ?? 'App';
    const line = `[${ctx}] ${message}`;
    process.stdout.write(`\x1b[33m[Nest]\x1b[0m ${new Date().toLocaleTimeString()} \x1b[33m   WARN\x1b[0m ${line}\n`);
    logToFile('warn', ctx, message);
  }

  debug(message: string, context?: string): void {
    const ctx = context ?? 'App';
    logToFile('debug', ctx, message);
  }

  verbose(message: string, context?: string): void {
    const ctx = context ?? 'App';
    logToFile('verbose', ctx, message);
  }
}
