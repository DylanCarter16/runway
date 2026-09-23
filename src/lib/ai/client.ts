import type Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import { parseJson } from './json';
import { modelFor, type Purpose } from './models';
import { costUsd } from './pricing';
import { jsonSchema } from './schemas';
import type { AiClearance } from './switch';

// Every Claude call goes through callClaude(). It takes an AiClearance (only
// assertAiAllowed() makes one), picks the model from env, validates structured
// output with zod, and records the call in ai_calls. Transport and logging are
// injected so tests run on recorded fixtures without network access.

export interface AiCallRow {
  user_id: string;
  purpose: Purpose;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  cost_usd: number | null;
  duration_ms: number;
  ok: boolean;
  error: string | null;
  request_ref: string | null;
  raw_output: unknown;
}

export interface AiDeps {
  send(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  log(row: AiCallRow): Promise<void>;
}

export interface ClaudeRequest<T> {
  purpose: Purpose;
  clearance: AiClearance;
  userId: string;
  requestRef?: string | null;
  system: string;
  user: string;
  /** Structured output: the zod schema doubles as the JSON schema. */
  schema: z.ZodType<T>;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high';
}

export interface ClaudeResult<T> {
  data: T;
  model: string;
  costUsd: number;
}

export class ClaudeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClaudeError';
  }
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

function emptyRow(req: { purpose: Purpose; userId: string; requestRef?: string | null }, model: string): AiCallRow {
  return {
    user_id: req.userId,
    purpose: req.purpose,
    model,
    input_tokens: null,
    output_tokens: null,
    cache_read_tokens: null,
    cache_write_tokens: null,
    cost_usd: null,
    duration_ms: 0,
    ok: false,
    error: null,
    request_ref: req.requestRef ?? null,
    raw_output: null,
  };
}

/** Sends one request, fills the usage columns, and logs the row however it ends. */
async function run<R>(
  deps: AiDeps,
  req: { purpose: Purpose; clearance: AiClearance; userId: string; requestRef?: string | null },
  params: (model: string) => Anthropic.MessageCreateParamsNonStreaming,
  read: (message: Anthropic.Message, text: string, row: AiCallRow, model: string) => R,
): Promise<R> {
  if (!req.clearance?.courseId) throw new ClaudeError('callClaude needs a clearance from assertAiAllowed().');
  const model = modelFor(req.purpose);
  const started = Date.now();
  const row = emptyRow(req, model);
  try {
    const message = await deps.send(params(model));
    const usage = message.usage;
    row.input_tokens = usage.input_tokens;
    row.output_tokens = usage.output_tokens;
    row.cache_read_tokens = usage.cache_read_input_tokens ?? null;
    row.cache_write_tokens = usage.cache_creation_input_tokens ?? null;
    row.cost_usd = costUsd(model, usage);
    const text = textOf(message);
    row.raw_output = { stop_reason: message.stop_reason, text };

    if (message.stop_reason === 'refusal') throw new ClaudeError('Claude declined this request.');
    if (message.stop_reason === 'max_tokens') throw new ClaudeError('The answer was cut off at the token limit.');
    const result = read(message, text, row, model);
    row.ok = true;
    return result;
  } catch (e) {
    row.error = (e instanceof Error ? e.message : String(e)).slice(0, 1000);
    throw e;
  } finally {
    row.duration_ms = Date.now() - started;
    await deps.log(row).catch(() => undefined);
  }
}

export async function callClaude<T>(deps: AiDeps, req: ClaudeRequest<T>): Promise<ClaudeResult<T>> {
  return run(
    deps,
    req,
    (model) => ({
      model,
      max_tokens: req.maxTokens ?? 16000,
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
      output_config: {
        effort: req.effort ?? 'medium',
        format: { type: 'json_schema', schema: jsonSchema(req.schema) },
      },
    }),
    (_message, text, row, model) => {
      let json: unknown;
      try {
        json = parseJson(text);
      } catch {
        throw new ClaudeError('Claude returned text that is not JSON.');
      }
      row.raw_output = json;
      const parsed = req.schema.safeParse(json);
      if (!parsed.success) {
        throw new ClaudeError(`Claude's answer did not match the schema: ${parsed.error.issues[0]?.message ?? 'unknown issue'}`);
      }
      return { data: parsed.data, model, costUsd: row.cost_usd ?? 0 };
    },
  );
}

export type TextRequest = Omit<ClaudeRequest<never>, 'schema'>;

export interface TextResult {
  text: string;
  model: string;
  costUsd: number;
}

/** Plain text output (note cleanup): same clearance, model choice, and logging as callClaude. */
export async function callClaudeText(deps: AiDeps, req: TextRequest): Promise<TextResult> {
  return run(
    deps,
    req,
    (model) => ({
      model,
      max_tokens: req.maxTokens ?? 16000,
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
      output_config: { effort: req.effort ?? 'medium' },
    }),
    (_message, text, _row, model) => {
      if (!text.trim()) throw new ClaudeError('Claude returned an empty answer.');
      return { text, model, costUsd: _row.cost_usd ?? 0 };
    },
  );
}
