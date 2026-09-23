import { z } from 'zod';
import type { AiCallRow } from './client';
import { AiNotAllowedError, type AiClearance } from './switch';

// Voyage AI embeddings for hybrid search (Phase 8). voyage-4 is Voyage's
// recommended general-purpose model (checked 2026-09-23): 1024 dimensions by
// default, 32,000 tokens of context, up to 1,000 texts and 320K tokens a request,
// $0.06 per million tokens after 200M free each month.
// Embedding sends course text to a third party, so it follows the course AI
// switch like every Claude call: a text goes only with its course's clearance.

export const EMBED_MODEL = 'voyage-4';
export const EMBED_DIMENSIONS = 1024;
export const EMBED_URL = 'https://api.voyageai.com/v1/embeddings';
const USD_PER_MTOK = 0.06;

/** Texts per request and a token ceiling well under the model's 320K limit. */
export const EMBED_BATCH_TEXTS = 128;
export const EMBED_BATCH_TOKENS = 100_000;

export interface VoyageRequest {
  input: string[];
  model: string;
  input_type: 'query' | 'document';
  output_dimension: number;
  truncation: boolean;
}

export const voyageResponseSchema = z.object({
  data: z.array(z.object({ embedding: z.array(z.number()), index: z.number().int().nonnegative() })),
  model: z.string(),
  usage: z.object({ total_tokens: z.number().int().nonnegative() }),
});

export interface EmbedDeps {
  /** POSTs the body to Voyage and returns the parsed JSON (tests replay recorded answers). */
  post(body: VoyageRequest): Promise<unknown>;
  log(row: AiCallRow): Promise<void>;
}

export function embedCostUsd(tokens: number): number {
  return (tokens / 1_000_000) * USD_PER_MTOK;
}

/** What gets embedded for a chunk: its heading, then its text. */
export function chunkEmbedText(chunk: { heading: string | null; content: string }): string {
  return chunk.heading ? `${chunk.heading}\n\n${chunk.content}` : chunk.content;
}

async function callVoyage(
  deps: EmbedDeps,
  req: { userId: string; purpose: 'embed' | 'embed_query'; texts: string[]; inputType: 'query' | 'document'; requestRef?: string | null },
): Promise<number[][]> {
  const started = Date.now();
  const row: AiCallRow = {
    user_id: req.userId,
    purpose: req.purpose,
    model: EMBED_MODEL,
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
  try {
    const raw = await deps.post({
      input: req.texts,
      model: EMBED_MODEL,
      input_type: req.inputType,
      output_dimension: EMBED_DIMENSIONS,
      truncation: true,
    });
    const parsed = voyageResponseSchema.parse(raw);
    const vectors: number[][] = new Array(req.texts.length);
    for (const d of parsed.data) {
      if (d.embedding.length !== EMBED_DIMENSIONS) throw new Error(`Voyage returned ${d.embedding.length} dimensions, expected ${EMBED_DIMENSIONS}.`);
      vectors[d.index] = d.embedding;
    }
    if (vectors.some((v) => !v) || parsed.data.length !== req.texts.length) throw new Error('Voyage returned the wrong number of embeddings.');
    row.ok = true;
    row.input_tokens = parsed.usage.total_tokens;
    row.cost_usd = embedCostUsd(parsed.usage.total_tokens);
    // The vectors themselves are stored on the chunks; the log keeps the counts.
    row.raw_output = { texts: req.texts.length, model: parsed.model };
    return vectors;
  } catch (e) {
    row.error = (e instanceof Error ? e.message : String(e)).slice(0, 2000);
    throw e;
  } finally {
    row.duration_ms = Date.now() - started;
    await deps.log(row);
  }
}

export interface EmbedChunk {
  id: string;
  courseId: string | null;
  heading: string | null;
  content: string;
  tokens: number;
}

/** Splits chunks into requests under the text and token ceilings, in order. */
export function embedBatches<T extends { tokens: number }>(chunks: T[], maxTexts = EMBED_BATCH_TEXTS, maxTokens = EMBED_BATCH_TOKENS): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let tokens = 0;
  for (const c of chunks) {
    if (current.length && (current.length >= maxTexts || tokens + c.tokens > maxTokens)) {
      batches.push(current);
      current = [];
      tokens = 0;
    }
    current.push(c);
    tokens += c.tokens;
  }
  if (current.length) batches.push(current);
  return batches;
}

/**
 * Embeds one batch of chunks as documents. Every chunk's course must have a
 * clearance, or nothing is sent.
 */
export async function embedChunks(
  deps: EmbedDeps,
  req: { userId: string; clearances: AiClearance[]; chunks: EmbedChunk[] },
): Promise<Map<string, number[]>> {
  const cleared = new Set(req.clearances.map((c) => c.courseId));
  for (const c of req.chunks) {
    if (!c.courseId || !cleared.has(c.courseId)) throw new AiNotAllowedError('A passage from a course with AI off was about to be embedded; nothing was sent.');
  }
  if (!req.chunks.length) return new Map();
  const vectors = await callVoyage(deps, {
    userId: req.userId,
    purpose: 'embed',
    texts: req.chunks.map(chunkEmbedText),
    inputType: 'document',
  });
  return new Map(req.chunks.map((c, i) => [c.id, vectors[i]]));
}

/** Embeds an Ask question. Needs at least one course clearance, like the Ask request itself. */
export async function embedQuery(
  deps: EmbedDeps,
  req: { userId: string; clearances: AiClearance[]; query: string; requestRef?: string | null },
): Promise<number[]> {
  if (!req.clearances.length) throw new AiNotAllowedError('No course in scope has AI on, so the question is not embedded.');
  const [vector] = await callVoyage(deps, {
    userId: req.userId,
    purpose: 'embed_query',
    texts: [req.query],
    inputType: 'query',
    requestRef: req.requestRef,
  });
  return vector;
}

/** pgvector's text form, which PostgREST casts to vector. */
export function toPgVector(v: number[]): string {
  return `[${v.join(',')}]`;
}
