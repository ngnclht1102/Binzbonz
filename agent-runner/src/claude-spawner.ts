import { execa } from 'execa';
import type { Actor } from './types.js';

export interface SpawnResult {
  sessionId: string | null;
  inputTokens: number;
  textOutput: string;
  rawStdout: string;
  rawStderr: string;
}

export async function spawnClaude(
  actor: Actor,
  prompt: string,
  onTextChunk?: (text: string) => void,
): Promise<SpawnResult> {
  const args: string[] = [];

  if (actor.session_id) {
    args.push('--resume', actor.session_id);
  }

  args.push(
    '--dangerously-skip-permissions',
    '--verbose',
    '--output-format', 'stream-json',
    '-p', prompt,
  );

  console.log(`[spawner] Running: claude ${args.join(' ').slice(0, 120)}...`);

  let fullText = '';
  let sessionId = actor.session_id;
  let inputTokens = 0;
  let rawStdout = '';
  let rawStderr = '';

  const proc = execa('claude', args, {
    timeout: 300_000,
    reject: false,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  // Collect stderr
  if (proc.stderr) {
    proc.stderr.on('data', (chunk: Buffer) => {
      rawStderr += chunk.toString();
    });
  }

  // Stream stdout line by line
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

          // content_block_delta — streaming text
          if (event.type === 'content_block_delta' && event.delta?.text) {
            fullText += event.delta.text;
            if (onTextChunk) onTextChunk(event.delta.text);
          }

          // assistant message — full text blocks
          if (event.type === 'assistant' && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === 'text') {
                fullText += block.text;
                if (onTextChunk) onTextChunk(block.text);
              }
            }
          }

          // result — session info and token count
          if (event.type === 'result') {
            sessionId = event.session_id ?? sessionId;
            inputTokens = event.usage?.input_tokens ?? inputTokens;
            // Result may also contain the final text
            if (event.result) {
              const resultText = typeof event.result === 'string' ? event.result : '';
              if (resultText && !fullText.includes(resultText)) {
                fullText += resultText;
                if (onTextChunk) onTextChunk(resultText);
              }
            }
          }
        } catch {
          // Not JSON — could be plain text output
          if (line.trim() && !line.startsWith('{')) {
            fullText += line + '\n';
            if (onTextChunk) onTextChunk(line + '\n');
          }
        }
      }
    });
  }

  const result = await proc;

  if (result.exitCode !== 0 && result.exitCode !== null) {
    console.error(`[spawner] Claude exited with code ${result.exitCode}`);
    if (rawStderr) console.error(`[spawner] stderr: ${rawStderr.slice(0, 500)}`);
  }

  // Log raw output for debugging if no text was captured
  if (!fullText.trim()) {
    console.log(`[spawner] No text captured. stdout (${rawStdout.length} bytes), stderr (${rawStderr.length} bytes)`);
    if (rawStdout.length < 2000) console.log(`[spawner] raw stdout: ${rawStdout}`);
    if (rawStderr.length < 2000) console.log(`[spawner] raw stderr: ${rawStderr}`);
  }

  return { sessionId, inputTokens, textOutput: fullText, rawStdout, rawStderr };
}
