import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';

const FLUSH_INTERVAL_MS = 1000;
const MAX_BUFFER_SIZE = 100;

interface LogEntry {
  timestamp: string;
  service: string;
  level: string;
  context: string;
  message: string;
}

class FileLogger {
  private buffer: LogEntry[] = [];
  private filePath: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;

  constructor(service: string) {
    const logsDir = resolve(process.env.BINZBONZ_LOGS_DIR ?? resolve(process.cwd(), 'logs'));
    if (!existsSync(logsDir)) {
      try { mkdirSync(logsDir, { recursive: true }); } catch { /* ignore */ }
    }

    // Walk up to find the project root (where logs/ should be)
    let root = process.cwd();
    for (let i = 0; i < 5; i++) {
      if (existsSync(resolve(root, 'turbo.json'))) break;
      root = resolve(root, '..');
    }
    const rootLogsDir = resolve(root, 'logs');
    if (!existsSync(rootLogsDir)) {
      try { mkdirSync(rootLogsDir, { recursive: true }); } catch { /* ignore */ }
    }

    const today = new Date().toISOString().slice(0, 10);
    this.filePath = resolve(rootLogsDir, `${service}-${today}.log`);

    this.timer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);

    // Flush on exit
    process.on('beforeExit', () => this.flush());
    process.on('SIGINT', () => { this.flush(); });
    process.on('SIGTERM', () => { this.flush(); });
  }

  log(level: string, context: string, message: string): void {
    this.buffer.push({
      timestamp: new Date().toISOString(),
      service: '',
      level,
      context,
      message,
    });

    if (this.buffer.length >= MAX_BUFFER_SIZE) {
      this.flush();
    }
  }

  flush(): void {
    if (this.flushing || this.buffer.length === 0) return;
    this.flushing = true;

    const entries = this.buffer.splice(0);
    const lines = entries
      .map((e) => `[${e.timestamp}] [${e.level.toUpperCase().padEnd(5)}] [${e.context}] ${e.message}`)
      .join('\n') + '\n';

    try {
      appendFileSync(this.filePath, lines, 'utf-8');
    } catch (err) {
      // If file write fails, print to stderr so we don't lose logs silently
      process.stderr.write(`[file-logger] Write failed: ${err}\n`);
      process.stderr.write(lines);
    }

    this.flushing = false;
  }

  destroy(): void {
    this.flush();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

// Singleton per service
const instances = new Map<string, FileLogger>();

export function getFileLogger(service: string): FileLogger {
  if (!instances.has(service)) {
    instances.set(service, new FileLogger(service));
  }
  return instances.get(service)!;
}

export { FileLogger };
