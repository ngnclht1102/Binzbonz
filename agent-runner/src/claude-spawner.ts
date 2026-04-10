import { execa } from 'execa';
import { log, error as logError } from './logger.js';

export interface SpawnResult {
  sessionId: string | null;
  inputTokens: number;
  textOutput: string;
  rawStdout: string;
  rawStderr: string;
  isNewSession: boolean;
  /** Set when the error is non-retryable (quota, billing, etc) — caller should stop and comment */
  fatalError: string | null;
}

interface RunResult extends SpawnResult {
  errors: string[];
  exitCode: number | null;
}

async function runClaude(
  args: string[],
  cwd: string | undefined,
  onTextChunk?: (text: string) => void,
): Promise<RunResult> {
  let fullText = '';
  let sessionId: string | null = null;
  let inputTokens = 0;
  let rawStdout = '';
  let rawStderr = '';
  const errors: string[] = [];

  const proc = execa('claude', args, {
    cwd: cwd ?? undefined,
    timeout: 300_000,
    reject: false,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (proc.stderr) {
    proc.stderr.on('data', (chunk: Buffer) => {
      rawStderr += chunk.toString();
    });
  }

  if (proc.stdout) {
    let buffer = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      const str = chunk.toString();
      rawStdout += str;
      buffer += str;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);

          if (event.type === 'content_block_delta' && event.delta?.text) {
            fullText += event.delta.text;
            if (onTextChunk) onTextChunk(event.delta.text);
          }

          if (event.type === 'assistant' && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === 'text') {
                fullText += block.text;
                if (onTextChunk) onTextChunk(block.text);
              }
            }
          }

          if (event.type === 'result') {
            sessionId = event.session_id ?? sessionId;
            inputTokens = event.usage?.input_tokens ?? inputTokens;
            if (event.is_error && event.errors) {
              errors.push(...event.errors);
            }
            if (event.result && typeof event.result === 'string' && !fullText.includes(event.result)) {
              fullText += event.result;
            }
          }
        } catch {
          if (line.trim() && !line.startsWith('{')) {
            fullText += line + '\n';
          }
        }
      }
    });
  }

  const result = await proc;

  if (result.exitCode !== 0 && result.exitCode !== null) {
    logError("spawner", `Claude exited with code ${result.exitCode}`);
    if (rawStderr) logError("spawner", `stderr: ${rawStderr.slice(0, 500)}`);
  }

  if (!fullText.trim() && (rawStdout.length > 0 || rawStderr.length > 0)) {
    log("spawner", `No text captured. stdout (${rawStdout.length} bytes), stderr (${rawStderr.length} bytes)`);
    if (rawStdout.length < 2000) log("spawner", `raw stdout: ${rawStdout}`);
    if (rawStderr.length < 2000) log("spawner", `raw stderr: ${rawStderr}`);
  }

  return {
    sessionId, inputTokens, textOutput: fullText,
    rawStdout, rawStderr, isNewSession: false, fatalError: null,
    errors, exitCode: result.exitCode ?? null,
  };
}

// --- Error classification ---

const QUOTA_PATTERNS = [
  'rate limit', 'rate_limit',
  'insufficient_quota', 'too many requests',
  'overloaded_error', 'over_capacity',
  'usage limit exceeded', 'plan limit exceeded',
  'billing', 'credit balance',
];

const SESSION_PATTERNS = [
  'no conversation found',
  'session not found',
  'invalid session',
];

function classifyError(result: RunResult): 'quota' | 'session_gone' | 'other' {
  // Only check errors array and stderr for classification — NOT stdout
  // (stdout may contain normal text that matches patterns like "capacity")
  const errorText = [
    ...result.errors,
    result.rawStderr,
  ].join(' ').toLowerCase();

  for (const pattern of QUOTA_PATTERNS) {
    if (errorText.includes(pattern.toLowerCase())) {
      log("spawner", `Error classified as QUOTA — matched pattern "${pattern}" in: ${errorText.slice(0, 200)}`);
      return 'quota';
    }
  }

  for (const pattern of SESSION_PATTERNS) {
    if (errorText.includes(pattern.toLowerCase())) {
      log("spawner", `Error classified as SESSION_GONE — matched pattern "${pattern}"`);
      return 'session_gone';
    }
  }

  // Log unclassified errors for debugging
  if (result.errors.length > 0 || result.rawStderr.trim()) {
    log("spawner", `Error classified as OTHER — errors: ${result.errors.join('; ').slice(0, 300)} stderr: ${result.rawStderr.slice(0, 300)}`);
  }

  return 'other';
}

function isSuccess(result: RunResult): boolean {
  return result.textOutput.trim().length > 0 || result.inputTokens > 0;
}

const RETRY_DELAYS = [2000, 4000, 8000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildFatalResult(message: string, sessionId: string | null): SpawnResult {
  return {
    sessionId,
    inputTokens: 0,
    textOutput: '',
    rawStdout: '',
    rawStderr: message,
    isNewSession: false,
    fatalError: message,
  };
}

export async function spawnClaude(
  existingSessionId: string | null,
  prompt: string,
  cwd: string | undefined,
  onTextChunk?: (text: string) => void,
): Promise<SpawnResult> {

  // === RESUME PATH ===
  if (existingSessionId) {
    const resumeArgs = [
      '--resume', existingSessionId,
      '--dangerously-skip-permissions',
      '--verbose',
      '--output-format', 'stream-json',
      '-p', prompt,
    ];

    for (let attempt = 1; attempt <= 3; attempt++) {
      log("spawner", `RESUME attempt ${attempt}/3: ${existingSessionId.slice(0, 8)} (cwd: ${cwd ?? 'inherited'})`);
      const result = await runClaude(resumeArgs, cwd, onTextChunk);

      // Log raw result for debugging
      log("spawner", `Result: exit=${result.exitCode} text=${result.textOutput.length}b errors=[${result.errors.join('; ').slice(0, 200)}] stderr=${result.rawStderr.slice(0, 200)} stdout=${result.rawStdout.slice(0, 200)}`);

      const errorType = classifyError(result);

      // QUOTA: stop everything, don't retry, don't create new session
      if (errorType === 'quota') {
        const msg = result.errors.join('; ') || result.rawStderr.slice(0, 300) || 'Unknown quota error';
        logError("spawner", `Quota/rate limit hit: ${msg}`);
        return buildFatalResult(msg, existingSessionId);
      }

      // SESSION GONE: skip retries, fall through to new session
      if (errorType === 'session_gone') {
        log("spawner", `Session ${existingSessionId.slice(0, 8)} not found — will init new session`);
        break;
      }

      // Success
      if (isSuccess(result)) {
        log("spawner", `Resume succeeded on attempt ${attempt}`);
        return { ...result, isNewSession: false, fatalError: null };
      }

      // Other error — retry
      if (attempt < 3) {
        log("spawner", `Resume attempt ${attempt} failed (exit ${result.exitCode}), retrying in ${RETRY_DELAYS[attempt - 1]}ms...`);
        await sleep(RETRY_DELAYS[attempt - 1]);
      } else {
        log("spawner", `Resume failed after 3 attempts — will init new session`);
      }
    }
  }

  // === NEW SESSION PATH ===
  const newArgs = [
    '--dangerously-skip-permissions',
    '--verbose',
    '--output-format', 'stream-json',
    '-p', prompt,
  ];

  for (let attempt = 1; attempt <= 3; attempt++) {
    log("spawner", `NEW SESSION attempt ${attempt}/3 (cwd: ${cwd ?? 'inherited'})`);
    const result = await runClaude(newArgs, cwd, onTextChunk);

    log("spawner", `Result: exit=${result.exitCode} text=${result.textOutput.length}b errors=[${result.errors.join('; ').slice(0, 200)}] stderr=${result.rawStderr.slice(0, 200)} stdout=${result.rawStdout.slice(0, 200)}`);

    const errorType = classifyError(result);

    // QUOTA: stop everything
    if (errorType === 'quota') {
      const msg = result.errors.join('; ') || result.rawStderr.slice(0, 300) || 'Unknown quota error';
      logError("spawner", `Quota/rate limit hit: ${msg}`);
      return buildFatalResult(msg, result.sessionId);
    }

    // Success
    if (isSuccess(result)) {
      log("spawner", `New session succeeded on attempt ${attempt}`);
      return { ...result, isNewSession: true, fatalError: null };
    }

    // Other error — retry
    if (attempt < 3) {
      log("spawner", `New session attempt ${attempt} failed (exit ${result.exitCode}), retrying in ${RETRY_DELAYS[attempt - 1]}ms...`);
      await sleep(RETRY_DELAYS[attempt - 1]);
    } else {
      log("spawner", `New session failed after 3 attempts`);
      return { ...result, isNewSession: true, fatalError: null };
    }
  }

  return buildFatalResult('All spawn attempts failed', null);
}
