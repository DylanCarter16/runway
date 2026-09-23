import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types';
import { addDaysToDate, toTorontoDate, toTorontoTime } from '@/lib/time';
import {
  ALL_SCOPE_TOP,
  COURSE_RECENT,
  COURSE_SEARCH_TOP,
  selectCourseChunks,
  withinBudget,
  type AskChunk,
  type ContextCourse,
} from './context';
import { toPgVector } from '@/lib/ai/embed';
import { fuseRankings, vectorHits, type QueryEmbedder } from '@/lib/search/hybrid';
import { GRADED_KINDS, type AskScope } from './scope';

// Loads what an Ask question needs (Phase 6 task 1): the scope's courses, the
// chunks, and the course context. Takes the signed-in user's client, so RLS
// scopes every read. Only courses with AI on are ever returned.

type Db = SupabaseClient<Database>;

export interface AskCourse {
  id: string;
  slug: string;
  code: string;
  title: string;
  ai_policy: string | null;
  late_policy: string | null;
  remark_policy: string | null;
  outline_url: string | null;
}

export interface PolicyBanner {
  courseCode: string;
  policy: string | null;
  outlineUrl: string | null;
}

export interface ResolvedScope {
  scope: AskScope;
  label: string;
  courses: AskCourse[];
  noteId: string | null;
  item: { id: string; title: string; kind: string; date: string | null; sourceDocumentId: string | null } | null;
  banner: PolicyBanner | null;
}

export class ScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScopeError';
  }
}

const COURSE_COLS = 'id, slug, code, title, ai_allowed, ai_policy, late_policy, remark_policy, outline_url';

async function aiCourses(db: Db): Promise<AskCourse[]> {
  const { data, error } = await db.from('courses').select(COURSE_COLS).eq('ai_allowed', true).eq('archived', false).order('sort_order');
  if (error) throw new Error(`Could not load courses: ${error.message}`);
  return data ?? [];
}

async function aiCourse(db: Db, courseId: string | null): Promise<AskCourse> {
  if (!courseId) throw new ScopeError('This has no course, so Ask can’t use it.');
  const { data } = await db.from('courses').select(COURSE_COLS).eq('id', courseId).maybeSingle();
  if (!data) throw new ScopeError('Unknown course.');
  if (!data.ai_allowed) throw new ScopeError(`${data.code} has AI turned off, so Ask doesn’t use its content.`);
  return data;
}

function itemDate(item: { due_at: string | null; starts_at: string | null }): string | null {
  const at = item.due_at ?? item.starts_at;
  return at ? toTorontoDate(new Date(at)) : null;
}

export async function resolveScope(db: Db, scope: AskScope): Promise<ResolvedScope> {
  switch (scope.type) {
    case 'all': {
      const courses = await aiCourses(db);
      return { scope, label: 'Everything', courses, noteId: null, item: null, banner: null };
    }
    case 'course': {
      const course = await aiCourse(db, scope.courseId);
      return { scope, label: course.code, courses: [course], noteId: null, item: null, banner: null };
    }
    case 'note': {
      const { data: note } = await db.from('notes').select('id, title, course_id, lecture_on').eq('id', scope.noteId).maybeSingle();
      if (!note) throw new ScopeError('That note no longer exists.');
      const course = await aiCourse(db, note.course_id);
      const title = note.title ?? 'Lecture note';
      return {
        scope,
        label: `${course.code} note: ${title}${note.lecture_on ? ` (${note.lecture_on})` : ''}`,
        courses: [course],
        noteId: note.id,
        item: null,
        banner: null,
      };
    }
    case 'item': {
      const { data: item } = await db
        .from('items')
        .select('id, title, kind, course_id, due_at, starts_at, source_document_id')
        .eq('id', scope.itemId)
        .maybeSingle();
      if (!item) throw new ScopeError('That item no longer exists.');
      const course = await aiCourse(db, item.course_id);
      const date = itemDate(item);
      return {
        scope,
        label: `${course.code} ${item.title} (${item.kind}${date ? `, ${date}` : ''})`,
        courses: [course],
        noteId: null,
        item: { id: item.id, title: item.title, kind: item.kind, date, sourceDocumentId: item.source_document_id },
        banner: GRADED_KINDS.has(item.kind) ? { courseCode: course.code, policy: course.ai_policy, outlineUrl: course.outline_url } : null,
      };
    }
  }
}

interface ChunkRow {
  id: string;
  parent_type: string;
  parent_id: string;
  course_id: string | null;
  ord: number;
  heading: string | null;
  content: string;
  token_estimate: number;
}

const CHUNK_COLS = 'id, parent_type, parent_id, course_id, ord, heading, content, token_estimate';

/** Adds each chunk's parent title, date, and link. */
async function hydrate(db: Db, rows: ChunkRow[]): Promise<AskChunk[]> {
  const noteIds = [...new Set(rows.filter((r) => r.parent_type === 'note').map((r) => r.parent_id))];
  const docIds = [...new Set(rows.filter((r) => r.parent_type === 'document').map((r) => r.parent_id))];
  const [{ data: notes }, { data: docs }] = await Promise.all([
    noteIds.length ? db.from('notes').select('id, title, lecture_on, created_at').in('id', noteIds) : Promise.resolve({ data: [] }),
    docIds.length ? db.from('documents').select('id, title, captured_at').in('id', docIds) : Promise.resolve({ data: [] }),
  ]);
  const titles = new Map<string, string>();
  for (const n of notes ?? []) titles.set(n.id, `${n.title ?? 'Lecture note'} (${n.lecture_on ?? toTorontoDate(new Date(n.created_at))})`);
  for (const d of docs ?? []) titles.set(d.id, `${d.title} (${toTorontoDate(new Date(d.captured_at))})`);
  return rows
    .filter((r) => titles.has(r.parent_id))
    .map((r) => ({
      id: r.id,
      parentType: r.parent_type === 'document' ? 'document' : 'note',
      parentId: r.parent_id,
      courseId: r.course_id,
      ord: r.ord,
      heading: r.heading,
      content: r.content,
      tokens: r.token_estimate || Math.ceil(r.content.length / 4),
      title: titles.get(r.parent_id)!,
      href: r.parent_type === 'document' ? `/library/${r.parent_id}` : `/notes/${r.parent_id}`,
    }));
}

/** search_chunks over each course, merged by rank. */
async function fullTextIds(db: Db, query: string, courseIds: string[], limit: number): Promise<string[]> {
  const results = await Promise.all(
    courseIds.map(async (courseId) => {
      const { data, error } = await db.rpc('search_chunks', { q: query, p_course_id: courseId, p_limit: limit });
      if (error) throw new Error(`Search failed: ${error.message}`);
      return data ?? [];
    }),
  );
  return results
    .flat()
    .filter((r) => r.course_id && courseIds.includes(r.course_id))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit)
    .map((r) => r.chunk_id);
}

/** match_chunks over each course: the nearest passages above the similarity floor. */
async function vectorIds(db: Db, vector: number[], courseIds: string[], limit: number): Promise<string[]> {
  const embedding = toPgVector(vector);
  const results = await Promise.all(
    courseIds.map(async (courseId) => {
      const { data, error } = await db.rpc('match_chunks', { query_embedding: embedding, p_course_id: courseId, p_limit: limit });
      if (error) throw new Error(`Vector search failed: ${error.message}`);
      return data ?? [];
    }),
  );
  return vectorHits(
    results.flat().filter((r) => r.course_id && courseIds.includes(r.course_id)),
    limit,
  ).map((r) => r.chunk_id);
}

/**
 * Passages that best match the query, best first. Used for retrieval and the
 * search_library tool. With an embedder (hybrid search on), full-text and
 * vector hits merge by reciprocal rank fusion; without one, or when embedding
 * fails, it is full-text search alone.
 */
export async function searchChunks(db: Db, query: string, courseIds: string[], limit: number, embed?: QueryEmbedder): Promise<AskChunk[]> {
  if (!query.trim() || !courseIds.length) return [];
  const [textIds, vector] = await Promise.all([fullTextIds(db, query, courseIds, limit), embed ? embed(query, courseIds) : null]);
  let ids = textIds;
  if (vector) {
    const near = await vectorIds(db, vector, courseIds, limit).catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      return [];
    });
    ids = fuseRankings([textIds, near], limit);
  }
  if (!ids.length) return [];
  // The search functions don't return ord or token counts; read them back.
  const { data: rows } = await db.from('chunks').select(CHUNK_COLS).in('id', ids);
  const byId = new Map((rows ?? []).map((r) => [r.id, r]));
  return hydrate(
    db,
    ids.map((id) => byId.get(id)).filter((r): r is ChunkRow => Boolean(r)),
  );
}

async function chunksWhere(db: Db, filter: { courseIds?: string[]; parentType?: 'note' | 'document'; parentIds?: string[] }, limit = 2000) {
  let q = db.from('chunks').select(CHUNK_COLS);
  if (filter.courseIds) q = q.in('course_id', filter.courseIds);
  if (filter.parentType) q = q.eq('parent_type', filter.parentType);
  if (filter.parentIds) q = q.in('parent_id', filter.parentIds);
  const { data, error } = await q.order('parent_id').order('ord').limit(limit);
  if (error) throw new Error(`Could not load passages: ${error.message}`);
  return (data ?? []) as ChunkRow[];
}

async function recentChunks(db: Db, courseIds: string[], limit: number): Promise<AskChunk[]> {
  const { data } = await db.from('chunks').select(CHUNK_COLS).in('course_id', courseIds).order('created_at', { ascending: false }).limit(limit);
  return hydrate(db, (data ?? []) as ChunkRow[]);
}

/** Notes first by lecture date, then documents; each parent's chunks in order. */
function inReadingOrder(chunks: AskChunk[]): AskChunk[] {
  return [...chunks].sort((a, b) => a.parentType.localeCompare(b.parentType) * -1 || a.title.localeCompare(b.title) || a.ord - b.ord);
}

export async function loadChunks(db: Db, resolved: ResolvedScope, question: string, budget: number, embed?: QueryEmbedder): Promise<AskChunk[]> {
  const courseIds = resolved.courses.map((c) => c.id);
  if (!courseIds.length) return [];
  const { scope } = resolved;

  if (scope.type === 'note') {
    return withinBudget(await hydrate(db, await chunksWhere(db, { parentType: 'note', parentIds: [scope.noteId], courseIds })), budget);
  }

  if (scope.type === 'item' && resolved.item) {
    const item = resolved.item;
    const docChunks = item.sourceDocumentId
      ? await hydrate(db, await chunksWhere(db, { parentType: 'document', parentIds: [item.sourceDocumentId], courseIds }))
      : [];
    // Notes from the three weeks before the item's date (or before today when it has none).
    const end = item.date ?? toTorontoDate(new Date());
    const { data: notes } = await db
      .from('notes')
      .select('id')
      .in('course_id', courseIds)
      .gte('lecture_on', addDaysToDate(end, -21))
      .lte('lecture_on', end);
    const noteIds = (notes ?? []).map((n) => n.id);
    const nearChunks = noteIds.length ? await hydrate(db, await chunksWhere(db, { parentType: 'note', parentIds: noteIds, courseIds })) : [];
    const hits = await searchChunks(db, `${item.title} ${question}`, courseIds, COURSE_SEARCH_TOP, embed);
    return withinBudget([...docChunks, ...inReadingOrder(nearChunks), ...hits], budget);
  }

  if (scope.type === 'course') {
    const all = inReadingOrder(await hydrate(db, await chunksWhere(db, { courseIds })));
    const total = all.reduce((sum, c) => sum + c.tokens, 0);
    if (total <= budget) return all;
    const [hits, recent] = await Promise.all([
      searchChunks(db, question, courseIds, COURSE_SEARCH_TOP, embed),
      recentChunks(db, courseIds, COURSE_RECENT),
    ]);
    return selectCourseChunks(all, hits, recent, budget);
  }

  // Everything: the top passages across every course with AI on, or the newest when nothing matches.
  const hits = await searchChunks(db, question, courseIds, ALL_SCOPE_TOP, embed);
  return withinBudget(hits.length ? hits : await recentChunks(db, courseIds, COURSE_RECENT), budget);
}

/** Policies and the next 5 active items for each course in scope. */
export async function loadCourseContext(db: Db, courses: AskCourse[], now = new Date()): Promise<ContextCourse[]> {
  if (!courses.length) return [];
  const { data: items } = await db
    .from('items')
    .select('course_id, kind, title, due_at, starts_at, time_known')
    .in(
      'course_id',
      courses.map((c) => c.id),
    )
    .eq('state', 'active')
    .or(`due_at.gte.${now.toISOString()},starts_at.gte.${now.toISOString()}`)
    .order('due_at', { ascending: true, nullsFirst: false })
    .limit(100);
  return courses.map((c) => ({
    code: c.code,
    title: c.title,
    late_policy: c.late_policy,
    ai_policy: c.ai_policy,
    remark_policy: c.remark_policy,
    next: (items ?? [])
      .filter((i) => i.course_id === c.id && i.kind !== 'break')
      .map((i) => {
        const at = i.due_at ?? i.starts_at;
        return {
          kind: i.kind,
          title: i.title,
          date: at ? toTorontoDate(new Date(at)) : null,
          time: at && i.time_known ? toTorontoTime(new Date(at)) : null,
          sort: at ?? '',
        };
      })
      .sort((a, b) => a.sort.localeCompare(b.sort))
      .slice(0, 5)
      .map((i) => ({ kind: i.kind, title: i.title, date: i.date, time: i.time })),
  }));
}

/** The policy line for the system prompt: one course, or each course by code. */
export function policyFor(courses: AskCourse[]): string | null {
  if (!courses.length) return null;
  if (courses.length === 1) return courses[0].ai_policy;
  const known = courses.filter((c) => c.ai_policy);
  return known.length ? known.map((c) => `${c.code}: ${c.ai_policy}`).join(' ') : null;
}
