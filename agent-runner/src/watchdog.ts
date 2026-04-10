/**
 * Watchdog: spawns the agent-runner and restarts it if it crashes.
 * - Restarts up to 10 times with exponential backoff (2s, 4s, 8s... max 30s)
 * - Resets the counter after 60s of stable running
 * - Kills child on SIGINT/SIGTERM
 */
import { fork } from 'child_process';
import { resolve } from 'path';

const ENTRY = resolve(import.meta.dirname ?? '.', 'index.ts');
const MAX_RESTARTS = 10;
const MAX_DELAY_MS = 30_000;
const STABLE_AFTER_MS = 60_000;

let restartCount = 0;
let child: ReturnType<typeof fork> | null = null;
let stopping = false;

function getDelay(): number {
  return Math.min(2000 * Math.pow(2, restartCount - 1), MAX_DELAY_MS);
}

function start() {
  if (stopping) return;

  const startTime = Date.now();
  console.log(`[watchdog] Starting agent-runner (attempt ${restartCount + 1})...`);

  child = fork(ENTRY, [], {
    execArgv: ['--import', 'tsx'],
    stdio: 'inherit',
  });

  child.on('exit', (code, signal) => {
    if (stopping) return;

    const uptime = Date.now() - startTime;

    // If it ran for long enough, reset the counter
    if (uptime > STABLE_AFTER_MS) {
      restartCount = 0;
    }

    if (code === 0 || signal === 'SIGINT' || signal === 'SIGTERM') {
      console.log(`[watchdog] Agent-runner exited cleanly (code=${code}, signal=${signal})`);
      return;
    }

    restartCount++;
    if (restartCount > MAX_RESTARTS) {
      console.error(`[watchdog] Agent-runner crashed ${MAX_RESTARTS} times. Giving up.`);
      process.exit(1);
    }

    const delay = getDelay();
    console.error(`[watchdog] Agent-runner crashed (code=${code}, uptime=${Math.round(uptime / 1000)}s). Restarting in ${delay}ms... (${restartCount}/${MAX_RESTARTS})`);
    setTimeout(start, delay);
  });
}

function shutdown(signal: string) {
  stopping = true;
  console.log(`[watchdog] ${signal} received, stopping agent-runner...`);
  if (child) {
    child.kill('SIGTERM');
    // Force kill after 5s
    setTimeout(() => {
      if (child && !child.killed) {
        child.kill('SIGKILL');
      }
      process.exit(0);
    }, 5000);
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start();
