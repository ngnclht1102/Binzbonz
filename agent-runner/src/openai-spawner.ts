/**
 * OpenAI-compatible spawner for openapidev / openapicoor agents.
 *
 * Mirror of claude-spawner.ts but for HTTP-based providers (DeepSeek, Kimi,
 * OpenAI, Groq, OpenRouter, ...). Returns the same SpawnResult shape so the
 * runner's downstream code is provider-agnostic.
 *
 * Flow:
 *   1. Read message_history (provided by caller)
 *   2. (Optional) compact if last_token_count > 80% of context window
 *   3. If first wake (history empty): push system message (skill file + identity)
 *   4. Push user message (task context built upstream)
 *   5. Tool-call loop (max 50 rounds):
 *        - Stream a chat completion
 *        - If tool_calls present: execute each, append role=tool messages, loop
 *        - Else: stop, return final assistant text
 *   6. Caller persists message_history + last_token_count via upsert
 *
 * Streaming: same UX as Claude — onTextChunk fires for each delta and the
 * runner buffers + posts progress comments every 10s.
 */

import type { Actor, OpenAIMessage, OpenAIToolCall } from './types.js';
import type { SpawnResult } from './claude-spawner.js';
import { getToolDefinitions, executeTool, type ToolContext } from './openai-tools.js';
import { compact, shouldCompact, getContextWindow } from './openai-compactor.js';
import { log, warn, error as logError } from './logger.js';

const TOOL_ROUND_BUDGET = 50;
const REQUEST_TIMEOUT_MS = 120_000;

export interface OpenAISpawnArgs {
  actor: Actor;
  projectId: string;
  /** Filesystem root for developer tools (read_file, write_file, run_shell).
   *  Null if the project has no repo_path — in that case developer tools
   *  will refuse to run. */
  repoPath: string | null;
  /** Existing message history for this (agent, project). Empty array on first wake. */
  history: OpenAIMessage[];
  /** New user message to append before the first call (already built by prompt-builder). */
  userMessage: string;
  /** System message (skill file + identity). Only used when history is empty. */
  systemMessage: string;
  /** Token count from the previous wake — used to decide whether to compact. */
  lastTokenCount: number;
  /** Streamed text deltas from the assistant. Same hook as the Claude flow. */
  onTextChunk?: (text: string) => void;
  /** Brief progress notes for tool rounds (no text content). */
  onToolNote?: (text: string) => void;
}

export interface OpenAISpawnResult extends SpawnResult {
  /** The full updated message_history to persist back to the DB. */
  messageHistory: OpenAIMessage[];
}

interface ChatCompletionDelta {
  role?: string;
  content?: string;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

interface ChatCompletionStreamChunk {
  choices?: Array<{
    delta?: ChatCompletionDelta;
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export async function spawnOpenAI(args: OpenAISpawnArgs): Promise<OpenAISpawnResult> {
  const { actor, projectId, userMessage, systemMessage, lastTokenCount } = args;

  if (!actor.provider_base_url || !actor.provider_api_key || !actor.provider_model) {
    return {
      messageHistory: args.history,
      sessionId: null,
      inputTokens: 0,
      textOutput: '',
      rawStdout: '',
      rawStderr: 'Missing provider config (base_url / model / api_key)',
      isNewSession: false,
      fatalError: 'Missing provider config',
    };
  }

  const baseUrl = actor.provider_base_url.replace(/\/$/, '');
  const apiKey = actor.provider_api_key;
  const model = actor.provider_model;

  // Build the working history. Compaction happens BEFORE we append the new
  // user message so the new user message doesn't get summarized away.
  let history: OpenAIMessage[] = [...args.history];
  const isNewSession = history.length === 0;

  if (!isNewSession && shouldCompact(model, lastTokenCount)) {
    log('openai', `Compaction triggered (tokens=${lastTokenCount} window=${getContextWindow(model)})`);
    history = await compact(history, baseUrl, apiKey, model);
  }

  // First wake: prepend the system message (skill file + identity)
  if (isNewSession) {
    history.push({ role: 'system', content: systemMessage, _ts: new Date().toISOString() });
  }

  // Append the user message for this wake.
  // For chat triggers, the message is already at the tail of history (the
  // chat endpoint appended it before creating the wake event). The runner
  // signals this by passing an empty userMessage — we just skip the push.
  if (userMessage) {
    history.push({ role: 'user', content: userMessage, _ts: new Date().toISOString() });
  }

  // ─── Tool-call loop ──────────────────────────────────────────────────

  const ctx: ToolContext = { actor, projectId, repoPath: args.repoPath };
  const tools = getToolDefinitions(actor.role);
  let totalTokens = lastTokenCount;
  let finalText = '';
  let fatalError: string | null = null;

  for (let round = 1; round <= TOOL_ROUND_BUDGET; round++) {
    log('openai', `Round ${round}/${TOOL_ROUND_BUDGET} — calling ${model}`);

    let assistantMsg: OpenAIMessage | null = null;
    let usage: { total_tokens?: number } | undefined;
    let assistantContent = '';
    const accumulatedToolCalls: OpenAIToolCall[] = [];

    try {
      const res = await fetchWithTimeout(
        `${baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: history,
            tools,
            stream: true,
          }),
        },
        REQUEST_TIMEOUT_MS,
      );

      if (res.status === 401 || res.status === 403) {
        const body = await res.text();
        fatalError = `Provider rejected API key (HTTP ${res.status}): ${body.slice(0, 200)}`;
        break;
      }
      if (res.status === 429) {
        const body = await res.text();
        fatalError = `Provider rate limit (HTTP 429): ${body.slice(0, 200)}`;
        break;
      }
      if (!res.ok) {
        const body = await res.text();
        fatalError = `Provider HTTP ${res.status}: ${body.slice(0, 300)}`;
        break;
      }
      if (!res.body) {
        fatalError = 'Provider returned no body';
        break;
      }

      // Parse SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE events are separated by double newlines
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const event of events) {
          const lines = event.split('\n').filter((l) => l.startsWith('data: '));
          for (const line of lines) {
            const payload = line.slice(6).trim();
            if (payload === '[DONE]') continue;
            if (!payload) continue;

            let chunk: ChatCompletionStreamChunk;
            try {
              chunk = JSON.parse(payload);
            } catch {
              continue;
            }

            const delta = chunk.choices?.[0]?.delta;
            if (delta?.content) {
              assistantContent += delta.content;
              if (args.onTextChunk) args.onTextChunk(delta.content);
            }

            // Tool call deltas come fragmented — accumulate by index
            if (delta?.tool_calls) {
              for (const tcDelta of delta.tool_calls) {
                const idx = tcDelta.index ?? 0;
                let existing = accumulatedToolCalls[idx];
                if (!existing) {
                  existing = {
                    id: tcDelta.id ?? '',
                    type: 'function',
                    function: { name: '', arguments: '' },
                  };
                  accumulatedToolCalls[idx] = existing;
                }
                if (tcDelta.id) existing.id = tcDelta.id;
                if (tcDelta.function?.name) existing.function.name += tcDelta.function.name;
                if (tcDelta.function?.arguments)
                  existing.function.arguments += tcDelta.function.arguments;
              }
            }

            if (chunk.usage) usage = chunk.usage;
          }
        }
      }
    } catch (err) {
      fatalError = `Provider request failed: ${err instanceof Error ? err.message : String(err)}`;
      break;
    }

    // Build the assistant message from this round
    const filledToolCalls = accumulatedToolCalls.filter((c) => c.function.name);
    const nowIso = new Date().toISOString();
    if (filledToolCalls.length > 0) {
      assistantMsg = {
        role: 'assistant',
        content: assistantContent || null,
        tool_calls: filledToolCalls,
        _ts: nowIso,
      };
    } else {
      assistantMsg = { role: 'assistant', content: assistantContent, _ts: nowIso };
    }
    history.push(assistantMsg);

    if (usage?.total_tokens) totalTokens = usage.total_tokens;

    // No tool calls → done, the assistant returned final text
    if (filledToolCalls.length === 0) {
      finalText = assistantContent;
      log('openai', `Round ${round} returned final text (${finalText.length} chars), exiting loop`);
      break;
    }

    // Execute each tool call and append results to history
    for (const call of filledToolCalls) {
      const noteMsg = `🛠 calling ${call.function.name}...`;
      if (args.onToolNote) args.onToolNote(noteMsg);

      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(call.function.arguments || '{}');
      } catch {
        parsedArgs = {};
      }

      const result = await executeTool(ctx, call.function.name, parsedArgs);
      history.push({
        role: 'tool',
        tool_call_id: call.id,
        content: typeof result === 'string' ? result : JSON.stringify(result),
        _ts: new Date().toISOString(),
      });
    }

    if (round === TOOL_ROUND_BUDGET) {
      fatalError = `Exceeded tool call budget (${TOOL_ROUND_BUDGET} rounds) — possible loop`;
      logError('openai', fatalError);
      break;
    }
  }

  return {
    messageHistory: history,
    sessionId: null, // OpenAI doesn't use session_id
    inputTokens: totalTokens,
    textOutput: finalText,
    rawStdout: '',
    rawStderr: fatalError ?? '',
    isNewSession,
    fatalError,
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
