import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { existsSync, readFileSync, rmSync } from 'fs';
import { resolve } from 'path';
import { createConnection } from 'net';

interface EmbeddedPostgresInstance {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface EmbeddedPostgresCtor {
  new (opts: Record<string, unknown>): EmbeddedPostgresInstance;
}

function isPortReachable(port: number, host = '127.0.0.1', timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.on('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    });
  });
}

@Injectable()
export class EmbeddedPostgresService implements OnApplicationShutdown {
  private readonly logger = new Logger(EmbeddedPostgresService.name);
  private instance: EmbeddedPostgresInstance | null = null;
  private startedByUs = false;
  private connectionString = '';

  async boot(): Promise<string> {
    // External mode
    const externalUrl = process.env.DATABASE_URL;
    if (externalUrl) {
      this.logger.log('Using external Postgres via DATABASE_URL');
      this.connectionString = externalUrl;
      return externalUrl;
    }

    // Embedded mode
    const dataDir = resolve(process.cwd(), 'data', 'postgres');
    const configuredPort = 54329;
    const user = 'binzbonz';
    const password = 'binzbonz';
    const dbName = 'binzbonz';

    const pgVersionFile = resolve(dataDir, 'PG_VERSION');
    const postmasterPidFile = resolve(dataDir, 'postmaster.pid');
    const clusterExists = existsSync(pgVersionFile);

    // Check if already running: PID alive AND port reachable
    const runningPid = this.readPidFromFile(postmasterPidFile);
    if (runningPid) {
      const portUp = await isPortReachable(configuredPort);
      if (portUp) {
        this.logger.log(
          `Reusing existing embedded Postgres (pid=${runningPid}, port=${configuredPort})`,
        );
        const connStr = `postgres://${user}:${password}@127.0.0.1:${configuredPort}/${dbName}`;
        this.connectionString = connStr;
        return connStr;
      } else {
        this.logger.warn(
          `PID ${runningPid} exists but port ${configuredPort} not reachable — stale process, will restart`,
        );
        // Kill the stale process
        try { process.kill(runningPid, 'SIGTERM'); } catch { /* ignore */ }
      }
    }

    // Detect free port
    const detectPort = (await import('detect-port')).default;
    const selectedPort = await detectPort(configuredPort);
    if (selectedPort !== configuredPort) {
      this.logger.warn(`Port ${configuredPort} busy, using ${selectedPort}`);
    }

    // Load embedded-postgres
    const mod = await import('embedded-postgres');
    const EmbeddedPostgres = mod.default as unknown as EmbeddedPostgresCtor;

    this.instance = new EmbeddedPostgres({
      databaseDir: dataDir,
      user,
      password,
      port: selectedPort,
      persistent: true,
      initdbFlags: ['--encoding=UTF8', '--locale=C'],
      onLog: (msg: unknown) => this.logger.debug(String(msg)),
      onError: (msg: unknown) => this.logger.error(String(msg)),
    });

    // Initialise cluster if first run
    if (!clusterExists) {
      this.logger.log('Initialising embedded Postgres cluster...');
      await this.instance.initialise();
    } else {
      this.logger.log('Existing cluster found, skipping init');
    }

    // Remove stale pid file
    if (existsSync(postmasterPidFile)) {
      this.logger.warn('Removing stale postmaster.pid');
      rmSync(postmasterPidFile, { force: true });
    }

    // Start
    this.logger.log(`Starting embedded Postgres on port ${selectedPort}...`);
    await this.instance.start();
    this.startedByUs = true;

    // Ensure database exists
    const adminConnStr = `postgres://${user}:${password}@127.0.0.1:${selectedPort}/postgres`;
    await this.ensureDatabase(adminConnStr, dbName);

    const connStr = `postgres://${user}:${password}@127.0.0.1:${selectedPort}/${dbName}`;
    this.connectionString = connStr;
    this.logger.log(`Embedded Postgres ready at port ${selectedPort}`);
    return connStr;
  }

  getConnectionString(): string {
    return this.connectionString;
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.instance && this.startedByUs) {
      this.logger.log('Stopping embedded Postgres...');
      try {
        await this.instance.stop();
        this.logger.log('Embedded Postgres stopped');
      } catch (err) {
        this.logger.error('Failed to stop embedded Postgres', err);
      }
    }
  }

  private readPidFromFile(pidFile: string): number | null {
    if (!existsSync(pidFile)) return null;
    try {
      const pidLine = readFileSync(pidFile, 'utf8').split('\n')[0]?.trim();
      const pid = Number(pidLine);
      if (!Number.isInteger(pid) || pid <= 0) return null;
      try {
        process.kill(pid, 0); // Check if process exists
        return pid;
      } catch {
        return null; // Process dead
      }
    } catch {
      return null;
    }
  }

  private async ensureDatabase(
    adminConnStr: string,
    dbName: string,
  ): Promise<void> {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: adminConnStr });
    try {
      await client.connect();
      const res = await client.query(
        `SELECT 1 FROM pg_database WHERE datname = $1`,
        [dbName],
      );
      if (res.rowCount === 0) {
        await client.query(`CREATE DATABASE "${dbName}"`);
        this.logger.log(`Created database: ${dbName}`);
      }
    } finally {
      await client.end();
    }
  }
}
