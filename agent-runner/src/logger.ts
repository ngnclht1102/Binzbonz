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

let buffer: LogEntry[] = [];
let flushing = false;
let filePath = '';

function init() {
  if (filePath) return;
  let root = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (existsSync(resolve(root, 'turbo.json'))) break;
    root = resolve(root, '..');
  }
  const logsDir = resolve(root, 'logs');
  if (!existsSync(logsDir)) {
    try { mkdirSync(logsDir, { recursive: true }); } catch { /* */ }
  }
  const today = new Date().toISOString().slice(0, 10);
  filePath = resolve(logsDir, `agent-runner-${today}.log`);

  setInterval(flush, FLUSH_INTERVAL_MS);
  process.on('beforeExit', flush);
  process.on('SIGINT', flush);
  process.on('SIGTERM', flush);
}

function flush() {
  if (flushing || buffer.length === 0) return;
  flushing = true;
  const entries = buffer.splice(0);
  const lines = entries
    .map((e) => `[${e.timestamp}] [${e.level.toUpperCase().padEnd(5)}] [${e.context}] ${e.message}`)
    .join('\n') + '\n';
  try { appendFileSync(filePath, lines, 'utf-8'); } catch { /* */ }
  flushing = false;
}

function writeLog(level: string, context: string, message: string) {
  init();
  buffer.push({ timestamp: new Date().toISOString(), level, context, message });
  if (buffer.length >= MAX_BUFFER_SIZE) flush();
}

export function log(context: string, message: string): void {
  console.log(`[${context}] ${message}`);
  writeLog('info', context, message);
}

export function warn(context: string, message: string): void {
  console.warn(`[${context}] ${message}`);
  writeLog('warn', context, message);
}

export function error(context: string, message: string): void {
  console.error(`[${context}] ${message}`);
  writeLog('error', context, message);
}

export function debug(context: string, message: string): void {
  writeLog('debug', context, message);
}
