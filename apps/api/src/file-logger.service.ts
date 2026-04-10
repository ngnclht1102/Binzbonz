import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

const FLUSH_INTERVAL_MS = 1000;
const MAX_BUFFER_SIZE = 100;

interface LogEntry {
  timestamp: string;
  level: string;
  context: string;
  message: string;
}

class BatchFileLogger {
  private buffer: LogEntry[] = [];
  private filePath: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;

  constructor(service: string) {
    let root = process.cwd();
    for (let i = 0; i < 5; i++) {
      if (existsSync(resolve(root, 'turbo.json'))) break;
      root = resolve(root, '..');
    }
    const logsDir = resolve(root, 'logs');
    if (!existsSync(logsDir)) {
      try { mkdirSync(logsDir, { recursive: true }); } catch { /* ignore */ }
    }

    const today = new Date().toISOString().slice(0, 10);
    this.filePath = resolve(logsDir, `${service}-${today}.log`);

    this.timer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
    process.on('beforeExit', () => this.flush());
    process.on('SIGINT', () => this.flush());
    process.on('SIGTERM', () => this.flush());
  }

  log(level: string, context: string, message: string): void {
    this.buffer.push({ timestamp: new Date().toISOString(), level, context, message });
    if (this.buffer.length >= MAX_BUFFER_SIZE) this.flush();
  }

  flush(): void {
    if (this.flushing || this.buffer.length === 0) return;
    this.flushing = true;
    const entries = this.buffer.splice(0);
    const lines = entries
      .map((e) => `[${e.timestamp}] [${e.level.toUpperCase().padEnd(5)}] [${e.context}] ${e.message}`)
      .join('\n') + '\n';
    try { appendFileSync(this.filePath, lines, 'utf-8'); } catch { /* silent */ }
    this.flushing = false;
  }
}

const apiLogger = new BatchFileLogger('api');

export function logToFile(level: string, context: string, message: string): void {
  apiLogger.log(level, context, message);
}
