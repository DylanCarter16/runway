import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { serverEnv } from '@/env';
import { EMBED_MODEL, EMBED_URL, embedQuery, toPgVector, type EmbedDeps, type VoyageRequest } from '@/lib/ai/embed';
import { assertAiAllowed, type CourseLookup } from '@/lib/ai/switch';
import type { Database, Json } from '@/lib/db/types';
import { embedPendingChunks, type EmbeddingStore, type QueryEmbedder } from '@/lib/search/hybrid';
import { monthSpendUsd, overBudget } from './ai';
import { enqueue, type Admin, type Job, type JobHandler } from './queue';

// Hybrid search, the database and network side (Phase 8): the Voyage transport,
// the embeddings.chunks job that fills chunks.embedding for courses with AI on,
// and the query embedder Ask uses when the setting is on.

type Db = SupabaseClient<Database>;

export const JOB_EMBED_CHUNKS = 'embeddings.chunks';

export function voyageConfigured(): boolean {
  return Boolean(serverEnv.VOYAGE_API_KEY);
}

async function postVoyage(body: VoyageRequest): Promise<unknown> {
  if (!serverEnv.VOYAGE_API_KEY) throw new Error('VOYAGE_API_KEY is not set, so hybrid search is unavailable.');
  // One retry for rate limits and server errors; each try stays well inside a job step.
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(EMBED_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serverEnv.VOYAGE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) return res.json();
    if (attempt < 2 && (res.status === 429 || res.status >= 500)) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    throw new Error(`Voyage AI answered ${res.status}.`);
  }
}

export function liveEmbedDeps(db: Db): EmbedDeps {
  return {
    post: postVoyage,
    async log(row) {
      const { error } = await db.from('ai_calls').insert({ ...row, raw_output: row.raw_output as Json });
      if (error) console.error('could not log embedding call:', error.message);
    },
  };
}

function lookupFor(db: Db, userId: string): CourseLookup {
  return async (courseId) => {
    const { data } = await db.from('courses').select('id, code, ai_allowed').eq('id', courseId).eq('user_id', userId).maybeSingle();
    return data;
  };
}

export function supabaseEmbeddingStore(db: Db, userId: string): EmbeddingStore {
  return {
    async pending(courseIds, limit) {
      if (!courseIds.length) return [];
      const { data, error } = await db
        .from('chunks')
        .select('id, course_id, heading, content, token_estimate')
        .eq('user_id', userId)
        .is('embedding', null)
        .in('course_id', courseIds)
        .order('created_at')
        .limit(limit);
      if (error) throw new Error(`Could not read passages to embed: ${error.message}`);
      return (data ?? []).map((c) => ({
        id: c.id,
        courseId: c.course_id,
        heading: c.heading,
        content: c.content,
        tokens: c.token_estimate || Math.ceil(c.content.length / 4),
      }));
    },
    async save(chunkId, vector) {
      const { error } = await db
        .from('chunks')
        .update({ embedding: toPgVector(vector), embedding_model: EMBED_MODEL })
        .eq('id', chunkId)
        .eq('user_id', userId);
      if (error) throw new Error(`Could not save an embedding: ${error.message}`);
    },
  };
}

export async function hybridSearchOn(db: Db, userId: string): Promise<boolean> {
  const { data } = await db.from('settings').select('ask_hybrid_search').eq('user_id', userId).maybeSingle();
  return Boolean(data?.ask_hybrid_search);
}

async function aiCourseIds(db: Db, userId: string): Promise<string[]> {
  const { data, error } = await db.from('courses').select('id').eq('user_id', userId).eq('ai_allowed', true);
  if (error) throw new Error(`Could not read courses: ${error.message}`);
  return (data ?? []).map((c) => c.id);
}

export function embedJob(userId: string, more = false) {
  return { userId, type: JOB_EMBED_CHUNKS, dedupeKey: more ? 'embeddings:chunks:more' : 'embeddings:chunks' };
}

/** The embeddings.chunks job. Quietly does nothing when the key, the setting, or the budget says no. */
export function makeEmbedChunksJob(depsFor: (admin: Admin) => EmbedDeps, configured: () => boolean): JobHandler {
  return async (admin: Admin, job: Job) => {
    if (!configured()) return;
    if (!(await hybridSearchOn(admin, job.user_id))) return;
    if (overBudget(await monthSpendUsd(admin, job.user_id))) return;
    const result = await embedPendingChunks(depsFor(admin), supabaseEmbeddingStore(admin, job.user_id), lookupFor(admin, job.user_id), {
      userId: job.user_id,
      courseIds: await aiCourseIds(admin, job.user_id),
    });
    if (result.more) await enqueue(admin, embedJob(job.user_id, true));
  };
}

export const EMBEDDING_HANDLERS: Record<string, JobHandler> = {
  [JOB_EMBED_CHUNKS]: makeEmbedChunksJob(liveEmbedDeps, voyageConfigured),
};

export interface EmbeddingStatus {
  configured: boolean;
  on: boolean;
  /** Passages from courses with AI on, and how many of them have an embedding. */
  total: number;
  embedded: number;
}

/** For Settings, AI. Takes the user's client, so RLS scopes the counts. */
export async function embeddingStatus(db: Db, userId: string): Promise<EmbeddingStatus> {
  const [on, courseIds] = await Promise.all([hybridSearchOn(db, userId), aiCourseIds(db, userId)]);
  if (!courseIds.length) return { configured: voyageConfigured(), on, total: 0, embedded: 0 };
  const [{ count: total }, { count: embedded }] = await Promise.all([
    db.from('chunks').select('id', { count: 'exact', head: true }).in('course_id', courseIds),
    db.from('chunks').select('id', { count: 'exact', head: true }).in('course_id', courseIds).not('embedding', 'is', null),
  ]);
  return { configured: voyageConfigured(), on, total: total ?? 0, embedded: embedded ?? 0 };
}

/**
 * Ask's query embedder when hybrid search is on and Voyage is set up, else
 * undefined (full-text search only). The question goes to Voyage only with a
 * clearance for every course it searches. Failures fall back to full-text search.
 */
export async function askQueryEmbedder(db: Db, userId: string): Promise<QueryEmbedder | undefined> {
  if (!voyageConfigured() || !(await hybridSearchOn(db, userId))) return undefined;
  const deps = liveEmbedDeps(db);
  const lookup = lookupFor(db, userId);
  return async (query, courseIds) => {
    try {
      const clearances = await Promise.all(courseIds.map((id) => assertAiAllowed(lookup, id)));
      return await embedQuery(deps, { userId, clearances, query });
    } catch (e) {
      console.error('query embedding failed, using full-text search only:', e instanceof Error ? e.message : e);
      return null;
    }
  };
}
