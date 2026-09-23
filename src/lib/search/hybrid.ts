import { embedBatches, embedChunks, type EmbedChunk, type EmbedDeps } from '@/lib/ai/embed';
import { aiAllowed, type AiClearance, type CourseLookup } from '@/lib/ai/switch';

// Hybrid search for Ask (Phase 8). Full-text search finds the exact words;
// embeddings find passages that say the same thing in other words. The two
// ranked lists merge by reciprocal rank fusion, which needs no score tuning:
// each list adds 1 / (k + rank) for every passage it holds.

export const RRF_K = 60;

/**
 * Vector hits below this cosine similarity are dropped, so a question the notes
 * don't cover still finds nothing (and Ask says so) instead of the nearest noise.
 * Not yet calibrated on real voyage-4 answers (no key when this was built):
 * `.scratch/record-embeddings.ts` records a STAT 230 passage set to check it.
 */
export const MIN_SIMILARITY = 0.3;

/** Merges ranked id lists, best first. Ties keep the earlier list's order. */
export function fuseRankings(lists: string[][], limit: number, k = RRF_K): string[] {
  const score = new Map<string, number>();
  const first = new Map<string, number>();
  let seen = 0;
  for (const list of lists) {
    list.forEach((id, rank) => {
      score.set(id, (score.get(id) ?? 0) + 1 / (k + rank + 1));
      if (!first.has(id)) first.set(id, seen++);
    });
  }
  return [...score.keys()].sort((a, b) => score.get(b)! - score.get(a)! || first.get(a)! - first.get(b)!).slice(0, limit);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Vector hits worth keeping, best first. */
export function vectorHits<T extends { similarity: number }>(rows: T[], limit: number, floor = MIN_SIMILARITY): T[] {
  return rows
    .filter((r) => r.similarity >= floor)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

/** Embeds a question for the given courses, or null to fall back to full-text search. */
export type QueryEmbedder = (query: string, courseIds: string[]) => Promise<number[] | null>;

export interface EmbeddingStore {
  /** Chunks with no embedding in the given courses, oldest first. */
  pending(courseIds: string[], limit: number): Promise<EmbedChunk[]>;
  save(chunkId: string, vector: number[]): Promise<void>;
}

export interface EmbedRunResult {
  embedded: number;
  /** True when chunks are still waiting (time ran out or the page was full). */
  more: boolean;
}

export const EMBED_PAGE = 256;

/**
 * Embeds waiting chunks from the given courses. Each course goes through the AI
 * switch first; chunks from any other course are never sent.
 */
export async function embedPendingChunks(
  deps: EmbedDeps,
  store: EmbeddingStore,
  lookup: CourseLookup,
  req: { userId: string; courseIds: string[]; budgetMs?: number; now?: () => number },
): Promise<EmbedRunResult> {
  const now = req.now ?? Date.now;
  const started = now();
  const budget = req.budgetMs ?? 40_000;

  const clearances: AiClearance[] = [];
  for (const id of req.courseIds) {
    const clearance = await aiAllowed(lookup, id);
    if (clearance) clearances.push(clearance);
  }
  if (!clearances.length) return { embedded: 0, more: false };
  const cleared = new Set(clearances.map((c) => c.courseId));

  const waiting = await store.pending([...cleared], EMBED_PAGE);
  const chunks = waiting.filter((c) => c.courseId && cleared.has(c.courseId));
  let embedded = 0;
  for (const batch of embedBatches(chunks)) {
    if (now() - started > budget) return { embedded, more: true };
    const vectors = await embedChunks(deps, { userId: req.userId, clearances, chunks: batch });
    for (const c of batch) {
      await store.save(c.id, vectors.get(c.id)!);
      embedded++;
    }
  }
  return { embedded, more: waiting.length >= EMBED_PAGE };
}
