import { describe, expect, it } from 'vitest';
import type { AiCallRow } from '@/lib/ai/client';
import {
  chunkEmbedText,
  EMBED_DIMENSIONS,
  EMBED_MODEL,
  embedBatches,
  embedChunks,
  embedCostUsd,
  embedQuery,
  toPgVector,
  type EmbedChunk,
  type EmbedDeps,
  type VoyageRequest,
} from '@/lib/ai/embed';
import { AiNotAllowedError, assertAiAllowed, type CourseLookup, type CourseSwitch } from '@/lib/ai/switch';
import { cosine, embedPendingChunks, EMBED_PAGE, fuseRankings, MIN_SIMILARITY, vectorHits, type EmbeddingStore } from '@/lib/search/hybrid';

// Hybrid search (Phase 8). No live Voyage calls: vectors are synthetic, with
// the real model's 1024 dimensions, and the transport is a fake.

const STAT = { id: 'c-stat230', code: 'STAT 230', ai_allowed: true };
const CS251 = { id: 'c-cs251', code: 'CS 251', ai_allowed: false };
const courses = new Map<string, CourseSwitch>([STAT, CS251].map((c) => [c.id, c]));
const lookup: CourseLookup = async (id) => courses.get(id) ?? null;

/** A unit-ish vector with weight on the given axes. */
function vec(...axes: number[]): number[] {
  const v = new Array(EMBED_DIMENSIONS).fill(0);
  for (const a of axes) v[a] += 1;
  return v;
}

function fakeVoyage(opts: { dims?: number; drop?: boolean } = {}) {
  const posts: VoyageRequest[] = [];
  const logs: AiCallRow[] = [];
  const deps: EmbedDeps = {
    async post(body) {
      posts.push(body);
      const data = body.input.map((text, index) => ({ embedding: new Array(opts.dims ?? EMBED_DIMENSIONS).fill(text.length % 7), index }));
      return {
        object: 'list',
        data: opts.drop ? data.slice(1) : data.reverse(),
        model: body.model,
        usage: { total_tokens: body.input.reduce((n, t) => n + Math.ceil(t.length / 4), 0) },
      };
    },
    async log(row) {
      logs.push(row);
    },
  };
  return { deps, posts, logs };
}

function chunk(id: string, courseId: string | null, content: string, tokens = 100): EmbedChunk {
  return { id, courseId, heading: `${id} heading`, content, tokens };
}

describe('fuseRankings', () => {
  it('puts a passage both lists found above one only a single list ranks first', () => {
    const fts = ['a', 'b', 'c'];
    const vector = ['d', 'b', 'e'];
    expect(fuseRankings([fts, vector], 5)[0]).toBe('b');
  });

  it('keeps every passage once, cuts to the limit, and breaks ties by first list', () => {
    const fused = fuseRankings([['a', 'b'], ['c', 'd']], 3);
    expect(fused).toEqual(['a', 'c', 'b']);
    expect(new Set(fuseRankings([['a', 'b'], ['b', 'a']], 10)).size).toBe(2);
  });

  it('with one list, keeps its order (full-text search alone is unchanged)', () => {
    expect(fuseRankings([['x', 'y', 'z']], 10)).toEqual(['x', 'y', 'z']);
    expect(fuseRankings([['x', 'y'], []], 10)).toEqual(['x', 'y']);
    expect(fuseRankings([[], []], 10)).toEqual([]);
  });
});

describe('vector hits and similarity', () => {
  it('cosine is 1 for the same direction and 0 for unrelated axes', () => {
    expect(cosine(vec(1, 2), vec(1, 2))).toBeCloseTo(1);
    expect(cosine(vec(1), vec(2))).toBe(0);
    expect(cosine(vec(), vec(1))).toBe(0);
  });

  it('drops hits under the floor so an uncovered question finds nothing', () => {
    const rows = [
      { chunk_id: 'far', similarity: MIN_SIMILARITY - 0.01 },
      { chunk_id: 'near', similarity: 0.8 },
      { chunk_id: 'mid', similarity: 0.5 },
    ];
    expect(vectorHits(rows, 10).map((r) => r.chunk_id)).toEqual(['near', 'mid']);
    expect(vectorHits(rows, 1).map((r) => r.chunk_id)).toEqual(['near']);
    expect(vectorHits([{ chunk_id: 'noise', similarity: 0.1 }], 10)).toEqual([]);
  });

  it('writes vectors in pgvector text form', () => {
    expect(toPgVector([0.5, -1, 0])).toBe('[0.5,-1,0]');
  });
});

describe('embedBatches', () => {
  it('splits by text count and by tokens, in order', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ id: i, tokens: 10 }));
    expect(embedBatches(many, 2, 1000).map((b) => b.map((c) => c.id))).toEqual([[0, 1], [2, 3], [4]]);
    const heavy = [{ tokens: 60 }, { tokens: 60 }, { tokens: 30 }, { tokens: 200 }];
    expect(embedBatches(heavy, 100, 100).map((b) => b.length)).toEqual([1, 2, 1]);
    expect(embedBatches([], 10, 10)).toEqual([]);
  });
});

describe('embedChunks', () => {
  it('sends STAT 230 passages as documents to voyage-4 at 1024 dimensions and logs the call', async () => {
    const stat = await assertAiAllowed(lookup, STAT.id);
    const { deps, posts, logs } = fakeVoyage();
    const chunks = [chunk('s1', STAT.id, 'Independence: P(A and B) = P(A)P(B)'), chunk('s2', STAT.id, 'Bayes rule')];
    const vectors = await embedChunks(deps, { userId: 'u1', clearances: [stat], chunks });

    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ model: EMBED_MODEL, input_type: 'document', output_dimension: 1024, truncation: true });
    expect(posts[0].input[0]).toBe(chunkEmbedText(chunks[0]));
    expect(posts[0].input[0].startsWith('s1 heading\n\n')).toBe(true);
    // Answers come back out of order; each vector still lands on its own chunk.
    expect(vectors.get('s1')![0]).toBe(chunkEmbedText(chunks[0]).length % 7);
    expect(vectors.get('s2')![0]).toBe(chunkEmbedText(chunks[1]).length % 7);

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ user_id: 'u1', purpose: 'embed', model: 'voyage-4', ok: true, error: null });
    expect(logs[0].input_tokens).toBeGreaterThan(0);
    expect(logs[0].cost_usd).toBeCloseTo(embedCostUsd(logs[0].input_tokens!));
    expect(JSON.stringify(logs[0].raw_output)).not.toContain('Independence');
  });

  it('refuses a CS 251 passage, or one with no course, and sends nothing', async () => {
    const stat = await assertAiAllowed(lookup, STAT.id);
    const { deps, posts, logs } = fakeVoyage();
    await expect(
      embedChunks(deps, { userId: 'u1', clearances: [stat], chunks: [chunk('s1', STAT.id, 'fine'), chunk('c1', CS251.id, 'CS 251 datapath notes')] }),
    ).rejects.toBeInstanceOf(AiNotAllowedError);
    await expect(embedChunks(deps, { userId: 'u1', clearances: [stat], chunks: [chunk('n1', null, 'no course yet')] })).rejects.toBeInstanceOf(
      AiNotAllowedError,
    );
    expect(posts).toHaveLength(0);
    expect(logs).toHaveLength(0);
  });

  it('logs a failed call when Voyage answers with the wrong size or too few vectors', async () => {
    const stat = await assertAiAllowed(lookup, STAT.id);
    const wrong = fakeVoyage({ dims: 512 });
    await expect(embedChunks(wrong.deps, { userId: 'u1', clearances: [stat], chunks: [chunk('s1', STAT.id, 'x')] })).rejects.toThrow(/512 dimensions/);
    expect(wrong.logs[0]).toMatchObject({ ok: false, purpose: 'embed' });

    const short = fakeVoyage({ drop: true });
    await expect(
      embedChunks(short.deps, { userId: 'u1', clearances: [stat], chunks: [chunk('s1', STAT.id, 'x'), chunk('s2', STAT.id, 'y')] }),
    ).rejects.toThrow(/wrong number/);
    expect(short.logs[0].ok).toBe(false);
  });
});

describe('embedQuery', () => {
  it('embeds the question as a query with purpose embed_query', async () => {
    const stat = await assertAiAllowed(lookup, STAT.id);
    const { deps, posts, logs } = fakeVoyage();
    const v = await embedQuery(deps, { userId: 'u1', clearances: [stat], query: 'are disjoint events independent?', requestRef: 't1' });
    expect(v).toHaveLength(EMBED_DIMENSIONS);
    expect(posts[0]).toMatchObject({ input_type: 'query', input: ['are disjoint events independent?'] });
    expect(logs[0]).toMatchObject({ purpose: 'embed_query', request_ref: 't1', ok: true });
  });

  it('sends nothing without a course clearance', async () => {
    const { deps, posts } = fakeVoyage();
    await expect(embedQuery(deps, { userId: 'u1', clearances: [], query: 'q' })).rejects.toBeInstanceOf(AiNotAllowedError);
    expect(posts).toHaveLength(0);
  });
});

function memoryStore(rows: EmbedChunk[]) {
  const saved = new Map<string, number[]>();
  const store: EmbeddingStore = {
    // Deliberately ignores the course filter, so the planner's own check is what keeps CS 251 out.
    async pending(_courseIds, limit) {
      return rows.filter((r) => !saved.has(r.id)).slice(0, limit);
    },
    async save(id, v) {
      saved.set(id, v);
    },
  };
  return { store, saved };
}

describe('embedPendingChunks', () => {
  it('embeds only passages from courses with AI on', async () => {
    const rows = [
      chunk('s1', STAT.id, 'STAT 230 independence'),
      chunk('c1', CS251.id, 'CS 251 pipelining hazards'),
      chunk('n1', null, 'a paste with no course'),
      chunk('s2', STAT.id, 'STAT 230 Bayes'),
    ];
    const { store, saved } = memoryStore(rows);
    const { deps, posts } = fakeVoyage();
    const result = await embedPendingChunks(deps, store, lookup, { userId: 'u1', courseIds: [STAT.id, CS251.id] });

    expect(result).toEqual({ embedded: 2, more: false });
    expect([...saved.keys()].sort()).toEqual(['s1', 's2']);
    const sent = posts.flatMap((p) => p.input).join('\n');
    expect(sent).not.toContain('CS 251');
    expect(sent).not.toContain('no course');
  });

  it('sends nothing when no course in the list has AI on', async () => {
    const { store, saved } = memoryStore([chunk('c1', CS251.id, 'CS 251 notes')]);
    const { deps, posts } = fakeVoyage();
    expect(await embedPendingChunks(deps, store, lookup, { userId: 'u1', courseIds: [CS251.id, 'c-unknown'] })).toEqual({ embedded: 0, more: false });
    expect(posts).toHaveLength(0);
    expect(saved.size).toBe(0);
  });

  it('stops when the time budget runs out and says more are waiting', async () => {
    const rows = Array.from({ length: 300 }, (_, i) => chunk(`s${i}`, STAT.id, `passage ${i}`, 1000));
    const { store, saved } = memoryStore(rows);
    const { deps } = fakeVoyage();
    let clock = 0;
    const result = await embedPendingChunks(deps, store, lookup, {
      userId: 'u1',
      courseIds: [STAT.id],
      budgetMs: 25,
      now: () => (clock += 10),
    });
    expect(result.more).toBe(true);
    expect(result.embedded).toBeGreaterThan(0);
    expect(result.embedded).toBeLessThan(EMBED_PAGE);
    expect(saved.size).toBe(result.embedded);
  });

  it('reports more when a full page was waiting', async () => {
    const rows = Array.from({ length: EMBED_PAGE + 5 }, (_, i) => chunk(`s${i}`, STAT.id, `p${i}`, 10));
    const { store, saved } = memoryStore(rows);
    const { deps } = fakeVoyage();
    const first = await embedPendingChunks(deps, store, lookup, { userId: 'u1', courseIds: [STAT.id] });
    expect(first).toEqual({ embedded: EMBED_PAGE, more: true });
    const second = await embedPendingChunks(deps, store, lookup, { userId: 'u1', courseIds: [STAT.id] });
    expect(second).toEqual({ embedded: 5, more: false });
    expect(saved.size).toBe(EMBED_PAGE + 5);
  });
});
