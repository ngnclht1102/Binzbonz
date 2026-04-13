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
import { AgentProjectSessionsService } from '../agent-project-sessions/agent-project-sessions.service.js';

interface ActiveSession {
  proc: pty.IPty;
  agentId: string;
  // Whether this PTY was spawned with --resume. We track it so we can detect
  // resume failures (claude exits within a few seconds, or its stderr/stdout
  // contains a "no conversation found" / "no deferred tool marker" message)
  // and automatically restart with a fresh session.
  attemptType: 'resume' | 'fresh';
  startedAt: number;
  outputBuffer: string;
}

// Patterns claude prints when --resume can't find or load the session file.
// If we see any of these in the first 4KB of output, we kill the PTY and
// fall through to a fresh session. Lower-cased for matching.
const UNUSABLE_RESUME_PATTERNS = [
  'no deferred tool marker',
  'no conversation found',
  'session not found',
  'invalid session',
];

// If a --resume PTY exits in less than this many ms, treat it as a resume
// failure even if no recognizable error string was captured. Real users
// don't close terminals that fast.
const FAST_EXIT_THRESHOLD_MS = 4000;

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
    private readonly sessions_svc: AgentProjectSessionsService,
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

    // Look up the per-project session for this (agent, project) pair
    const sessionRow = await this.sessions_svc.findOne(agentId, projectId);
    const resumeSessionId = sessionRow?.session_id ?? null;

    this.spawnPty(client, {
      agentId,
      projectId,
      cwd,
      claudePath,
      actorName: actor.name,
      actorRole: actor.role,
      sessionId: resumeSessionId,
      attemptType: resumeSessionId ? 'resume' : 'fresh',
    });
  }

  /**
   * Spawn a claude PTY for this client. If `attemptType === 'resume'` and
   * the spawn fails fast or claude reports an unusable session id, kills
   * the PTY and respawns with a fresh session in the same workspace.
   */
  private spawnPty(
    client: any,
    opts: {
      agentId: string;
      projectId: string;
      cwd: string;
      claudePath: string;
      actorName: string;
      actorRole: string | null;
      sessionId: string | null;
      attemptType: 'resume' | 'fresh';
    },
  ): void {
    const args = ['--dangerously-skip-permissions'];
    let sessionLabel: string;
    if (opts.attemptType === 'resume' && opts.sessionId) {
      args.push('--resume', opts.sessionId);
      sessionLabel = `resuming session ${opts.sessionId.slice(0, 8)}`;
    } else {
      sessionLabel = 'new interactive session';
    }

    this.logger.log(
      `Starting terminal for ${opts.actorName} in ${opts.cwd} (${sessionLabel})`,
    );

    try {
      client.send(
        JSON.stringify({
          type: 'output',
          data: `\r\n\x1b[36m🔌 ${opts.actorName} (${opts.actorRole ?? 'agent'}) — ${sessionLabel} in ${opts.cwd}\x1b[0m\r\n\r\n`,
        }),
      );
    } catch {
      /* client gone */
    }

    let proc: pty.IPty;
    try {
      proc = pty.spawn(opts.claudePath, args, {
        name: 'xterm-256color',
        cols: 120,
        rows: 40,
        cwd: opts.cwd,
        env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to spawn PTY: ${msg}`);
      try {
        client.send(JSON.stringify({ type: 'error', data: `Failed to start terminal: ${msg}` }));
      } catch { /* client gone */ }
      return;
    }

    const session: ActiveSession = {
      proc,
      agentId: opts.agentId,
      attemptType: opts.attemptType,
      startedAt: Date.now(),
      outputBuffer: '',
    };
    this.sessions.set(client, session);

    proc.onData((data: string) => {
      // Buffer the first 4KB of output for resume-failure detection.
      // Once we've seen 4KB or matched a pattern, we stop buffering.
      if (session.attemptType === 'resume' && session.outputBuffer.length < 4096) {
        session.outputBuffer += data;
        const lower = session.outputBuffer.toLowerCase();
        for (const pattern of UNUSABLE_RESUME_PATTERNS) {
          if (lower.includes(pattern)) {
            this.logger.warn(
              `Resume failed for ${opts.actorName} — matched "${pattern}", falling back to fresh session`,
            );
            // Mark so onExit doesn't double-fall-through
            session.attemptType = 'fresh';
            try {
              session.proc.kill();
            } catch { /* already dead */ }
            return;
          }
        }
      }
      try {
        client.send(JSON.stringify({ type: 'output', data }));
      } catch { /* client gone */ }
    });

    proc.onExit(({ exitCode }) => {
      const elapsed = Date.now() - session.startedAt;
      this.logger.log(
        `Terminal exited for ${opts.actorName} (code: ${exitCode}, elapsed: ${elapsed}ms, attempt: ${opts.attemptType})`,
      );

      // Detect resume failure: this attempt was a resume AND it died fast,
      // OR we already saw an unusable-resume marker in the buffer.
      const looksLikeResumeFailure =
        opts.attemptType === 'resume' &&
        (elapsed < FAST_EXIT_THRESHOLD_MS ||
          this.outputContainsResumeError(session.outputBuffer));

      this.sessions.delete(client);

      if (looksLikeResumeFailure) {
        try {
          client.send(
            JSON.stringify({
              type: 'output',
              data: `\r\n\x1b[33m⚠ Could not resume session ${opts.sessionId?.slice(0, 8)} — starting a fresh interactive session in the same workspace.\x1b[0m\r\n`,
            }),
          );
        } catch { /* client gone */ }
        // Restart as fresh
        this.spawnPty(client, { ...opts, attemptType: 'fresh', sessionId: null });
        return;
      }

      try {
        client.send(
          JSON.stringify({
            type: 'exit',
            data: `\r\n\r\n📴 Session ended (exit code: ${exitCode})\r\n`,
          }),
        );
      } catch { /* client gone */ }
    });
  }

  private outputContainsResumeError(output: string): boolean {
    const lower = output.toLowerCase();
    return UNUSABLE_RESUME_PATTERNS.some((p) => lower.includes(p));
  }
}
