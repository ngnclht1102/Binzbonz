import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Server } from 'ws';
import { execSync } from 'child_process';
import * as pty from '@homebridge/node-pty-prebuilt-multiarch';
import { Actor } from '../actors/actor.entity.js';
import { Project } from '../projects/project.entity.js';

interface ActiveSession {
  proc: pty.IPty;
  agentId: string;
}

@WebSocketGateway({ path: '/terminal' })
export class TerminalGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(TerminalGateway.name);
  private sessions = new Map<unknown, ActiveSession>();

  @WebSocketServer()
  server!: Server;

  constructor(
    @InjectRepository(Actor)
    private readonly actorRepo: Repository<Actor>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
  ) {}

  async handleConnection(client: any): Promise<void> {
    this.logger.log('Terminal WebSocket client connected');

    client.on('message', async (raw: Buffer | string) => {
      const msg = raw.toString();
      let data: any;

      try {
        data = JSON.parse(msg);
      } catch {
        return;
      }

      if (data.type === 'init') {
        if (this.sessions.has(client)) {
          this.logger.debug('Ignoring duplicate init');
          return;
        }
        await this.startSession(client, data.agentId, data.projectId);
        return;
      }

      const session = this.sessions.get(client);
      if (!session) return;

      if (data.type === 'resize' && data.cols && data.rows) {
        session.proc.resize(data.cols, data.rows);
      } else if (data.type === 'input' && data.data) {
        session.proc.write(data.data);
      }
    });
  }

  handleDisconnect(client: any): void {
    this.logger.log('Terminal WebSocket client disconnected');
    const session = this.sessions.get(client);
    if (session) {
      session.proc.kill();
      this.sessions.delete(client);
    }
  }

  private async startSession(client: any, agentId: string, projectId: string): Promise<void> {
    const actor = await this.actorRepo.findOne({ where: { id: agentId } });
    if (!actor) {
      client.send(JSON.stringify({ type: 'error', data: `Agent ${agentId} not found` }));
      return;
    }

    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    const cwd = project?.repo_path ?? process.cwd();

    // Resolve claude path
    let claudePath = 'claude';
    try {
      claudePath = execSync('which claude', { encoding: 'utf-8' }).trim();
    } catch {
      this.logger.warn('Could not resolve claude path');
    }

    // Resume the agent's actual session if it has one
    const args = ['--dangerously-skip-permissions'];
    let sessionLabel = 'new session';
    if (actor.session_id) {
      args.push('--resume', actor.session_id);
      sessionLabel = `resuming session ${actor.session_id.slice(0, 8)}`;
    }

    this.logger.log(`Starting terminal for ${actor.name} in ${cwd} (${sessionLabel})`);

    client.send(JSON.stringify({
      type: 'output',
      data: `\r\n🔌 Connected to ${actor.name} (${actor.role}) — ${sessionLabel} in ${cwd}\r\n\r\n`,
    }));

    let proc: pty.IPty;
    try {
      proc = pty.spawn(claudePath, args, {
        name: 'xterm-256color',
        cols: 120,
        rows: 40,
        cwd,
        env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to spawn PTY: ${msg}`);
      client.send(JSON.stringify({ type: 'error', data: `Failed to start terminal: ${msg}` }));
      return;
    }

    this.sessions.set(client, { proc, agentId });

    proc.onData((data: string) => {
      try {
        client.send(JSON.stringify({ type: 'output', data }));
      } catch { /* client gone */ }
    });

    proc.onExit(({ exitCode }) => {
      this.logger.log(`Terminal exited for ${actor.name} (code: ${exitCode})`);
      try {
        client.send(JSON.stringify({
          type: 'exit',
          data: `\r\n\r\n📴 Session ended (exit code: ${exitCode})\r\n`,
        }));
      } catch { /* client gone */ }
      this.sessions.delete(client);
    });
  }
}
