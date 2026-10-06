'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { TERM_F26 } from '@/config/term-f26';
import { createClient, requireUser } from '@/lib/db/server';
import type { Tables } from '@/lib/db/types';
import { buildItemUpdate, itemFormSchema, whenFromForm, type ItemForm } from '@/lib/items/edit';
import { expandQuery } from '@/lib/search/aliases';
import { importTerm } from '@/lib/term/import';

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

function err(error: string): ActionResult<never> {
  return { ok: false, error };
}

async function session() {
  const user = await requireUser();
  const supabase = await createClient();
  return { user, supabase };
}

function refreshAll() {
  revalidatePath('/', 'layout');
}

// ---------------------------------------------------------------------------
// Term
// ---------------------------------------------------------------------------

export async function loadTermSetup() {
  const { user, supabase } = await session();
  try {
    const result = await importTerm(supabase, TERM_F26, user.id);
    refreshAll();
    return ok({ created: result.created, updated: result.updated });
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Loading the term failed.');
  }
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export async function createItem(input: ItemForm): Promise<ActionResult<{ id: string }>> {
  const parsed = itemFormSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Check the form.');
  const { user, supabase } = await session();
  const form = parsed.data;
  const { data, error } = await supabase
    .from('items')
    .insert({
      user_id: user.id,
      course_id: form.courseId,
      kind: form.kind,
      title: form.title,
      ...whenFromForm(form),
      weight_percent: form.weight,
      location: form.location ?? null,
      description: form.description ?? null,
      source: 'manual',
      last_change_source: 'manual',
    })
    .select('id')
    .single();
  if (error) return err(`Could not add the item: ${error.message}`);
  refreshAll();
  return ok({ id: data.id });
}

export async function updateItem(id: string, input: ItemForm): Promise<ActionResult> {
  const parsed = itemFormSchema.safeParse(input);
  if (!parsed.success || !z.uuid().safeParse(id).success) {
    return err(parsed.error?.issues[0]?.message ?? 'Check the form.');
  }
  const { supabase } = await session();
  const { data: before, error: readError } = await supabase.from('items').select('*').eq('id', id).single();
  if (readError) return err('That item no longer exists.');
  const update = buildItemUpdate({ ...before, weight_percent: before.weight_percent === null ? null : Number(before.weight_percent) }, parsed.data);
  const { error } = await supabase.from('items').update(update).eq('id', id);
  if (error) return err(`Could not save: ${error.message}`);
  refreshAll();
  return ok(null);
}

const progressSchema = z.enum(['todo', 'started', 'submitted', 'graded']);

export async function setProgress(id: string, progress: string): Promise<ActionResult> {
  const p = progressSchema.safeParse(progress);
  if (!p.success || !z.uuid().safeParse(id).success) return err('Unknown progress value.');
  const { supabase } = await session();
  const done = p.data === 'submitted' || p.data === 'graded';
  const { error } = await supabase
    .from('items')
    .update({
      progress: p.data,
      submitted_at: done ? new Date().toISOString() : null,
      last_change_source: 'manual',
    })
    .eq('id', id);
  if (error) return err(`Could not update progress: ${error.message}`);
  refreshAll();
  return ok(null);
}

export async function setItemState(id: string, state: 'active' | 'dismissed'): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success || !['active', 'dismissed'].includes(state)) return err('Bad request.');
  const { supabase } = await session();
  const { error } = await supabase.from('items').update({ state, last_change_source: 'manual' }).eq('id', id);
  if (error) return err(`Could not update the item: ${error.message}`);
  refreshAll();
  return ok(null);
}

export interface ItemDetail {
  item: Tables<'items'>;
  changes: { id: string; field: string; old_value: string | null; new_value: string | null; source: string | null; detected_at: string }[];
  lastSync: { finished_at: string | null; ok: boolean | null } | null;
  course: { late_policy: string | null; checklist: string[]; ai_allowed: boolean } | null;
}

async function readItem(id: string) {
  const { supabase } = await session();
  const { data: item, error } = await supabase.from('items').select('*').eq('id', id).single();
  if (error) return { item: null, supabase };
  return { item, supabase };
}

export async function getItemDetail(id: string): Promise<ActionResult<ItemDetail>> {
  if (!z.uuid().safeParse(id).success) return err('That item does not exist.');
  const { item, supabase } = await readItem(id);
  if (!item) return err('That item does not exist.');
  const [changes, sync, course] = await Promise.all([
    supabase
      .from('item_changes')
      .select('id, field, old_value, new_value, source, detected_at')
      .eq('item_id', id)
      .order('detected_at', { ascending: false })
      .limit(50),
    supabase
      .from('sync_runs')
      .select('finished_at, ok')
      .eq('source', item.source)
      .order('started_at', { ascending: false })
      .limit(1),
    item.course_id
      ? supabase.from('courses').select('late_policy, checklist, ai_allowed').eq('id', item.course_id).single()
      : Promise.resolve({ data: null }),
  ]);
  const c = course.data;
  return ok({
    item,
    changes: changes.data ?? [],
    lastSync: sync.data?.[0] ?? null,
    course: c ? { late_policy: c.late_policy, checklist: (c.checklist as string[]) ?? [], ai_allowed: c.ai_allowed } : null,
  });
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchHit {
  /** `page` is a page of an uploaded file: `id` is the file, `page` the page number. */
  type: 'item' | 'note' | 'document' | 'page' | 'link';
  id: string;
  courseId: string | null;
  title: string;
  snippet: string | null;
  at: string | null;
  url: string | null;
  kind: string | null;
  page: number | null;
}

export async function search(query: string, opts: { limit?: number; courseId?: string | null } = {}): Promise<ActionResult<SearchHit[]>> {
  const q = z.string().max(200).safeParse(query);
  if (!q.success) return err('Search is limited to 200 characters.');
  if (!z.uuid().nullish().safeParse(opts.courseId).success) return err('Unknown course.');
  const { supabase } = await session();
  const { data: courses } = await supabase.from('courses').select('id, code, slug').eq('archived', false);
  const expanded = expandQuery(q.data, courses ?? []);
  const courseId = opts.courseId ?? expanded.course?.id ?? null;
  const limit = Math.min(opts.limit ?? 30, 100);

  let hits: SearchHit[] = [];
  if (expanded.text) {
    const { data, error } = await supabase.rpc('search_all', {
      q: expanded.text,
      p_course_id: courseId ?? undefined,
      p_limit: limit,
    });
    if (error) return err(`Search failed: ${error.message}`);
    hits = (data ?? []).map((r) => ({
      type: r.result_type as SearchHit['type'],
      id: r.result_id,
      courseId: r.course_id,
      title: r.title,
      // ts_headline marks matches with <b>; the palette shows plain text.
      snippet: r.result_type === 'link' ? null : (r.snippet?.replace(/<\/?b>/g, '') ?? null),
      at: r.happened_at,
      url: r.result_type === 'link' ? r.snippet : null,
      kind: null,
      page: r.page ?? null,
    }));
  } else if (courseId) {
    // The query named only a course: list its next items.
    const { data } = await supabase
      .from('items')
      .select('id, course_id, title, due_at, starts_at, kind, location')
      .eq('course_id', courseId)
      .eq('state', 'active')
      .gte('due_at', new Date(Date.now() - 86_400_000).toISOString())
      .order('due_at')
      .limit(limit);
    hits = (data ?? []).map((r) => ({
      type: 'item',
      id: r.id,
      courseId: r.course_id,
      title: r.title,
      snippet: r.location,
      at: r.due_at ?? r.starts_at,
      url: null,
      kind: r.kind,
      page: null,
    }));
  }

  const itemIds = hits.filter((h) => h.type === 'item' && !h.kind).map((h) => h.id);
  if (itemIds.length) {
    const { data } = await supabase.from('items').select('id, kind').in('id', itemIds);
    const kinds = new Map((data ?? []).map((r) => [r.id, r.kind]));
    hits = hits.map((h) => (h.type === 'item' ? { ...h, kind: h.kind ?? kinds.get(h.id) ?? null } : h));
  }
  if (expanded.kind) {
    // A kind alias ("mt", "final") keeps items of that kind and drops other items.
    hits = hits.filter((h) => h.type !== 'item' || h.kind === expanded.kind);
  }
  return ok(hits);
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

const CATEGORIES = [
  'course_site', 'discussion', 'lms', 'submission', 'grades', 'notes',
  'exam', 'outline', 'office_hours', 'contact', 'policy', 'other',
] as const;

const linkSchema = z.object({
  courseId: z.uuid().nullable(),
  label: z.string().trim().min(1, 'Add a label').max(120),
  url: z.url('Use a full URL starting with https://').max(2000),
  category: z.enum(CATEGORIES),
  whereToFind: z.string().trim().max(1000).nullable(),
  pinned: z.boolean(),
});

export type LinkForm = z.infer<typeof linkSchema>;

export async function saveLink(id: string | null, input: LinkForm): Promise<ActionResult> {
  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Check the link.');
  const { user, supabase } = await session();
  const f = parsed.data;
  const row = {
    course_id: f.courseId,
    label: f.label,
    url: f.url,
    category: f.category,
    where_to_find: f.whereToFind || null,
    pinned: f.pinned,
  };
  if (id) {
    const { error } = await supabase.from('links').update(row).eq('id', id);
    if (error) return err(error.code === '23505' ? 'That link is already saved.' : error.message);
  } else {
    let order = supabase.from('links').select('sort_order').order('sort_order', { ascending: false }).limit(1);
    order = f.courseId ? order.eq('course_id', f.courseId) : order.is('course_id', null);
    const { data: last } = await order;
    const { error } = await supabase
      .from('links')
      .insert({ ...row, user_id: user.id, sort_order: (last?.[0]?.sort_order ?? -1) + 1 });
    if (error) return err(error.code === '23505' ? 'That link is already saved.' : error.message);
  }
  refreshAll();
  return ok(null);
}

export async function deleteLink(id: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return err('Bad request.');
  const { supabase } = await session();
  const { error } = await supabase.from('links').delete().eq('id', id);
  if (error) return err(error.message);
  refreshAll();
  return ok(null);
}

export async function setLinkPinned(id: string, pinned: boolean): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return err('Bad request.');
  const { supabase } = await session();
  const { error } = await supabase.from('links').update({ pinned }).eq('id', id);
  if (error) return err(error.message);
  refreshAll();
  return ok(null);
}

/** Moves a link one place up or down among its course's links. */
export async function moveLink(id: string, direction: 'up' | 'down'): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return err('Bad request.');
  const { supabase } = await session();
  const { data: link } = await supabase.from('links').select('id, course_id').eq('id', id).single();
  if (!link) return err('That link no longer exists.');
  let q = supabase.from('links').select('id, sort_order').order('sort_order').order('created_at');
  q = link.course_id ? q.eq('course_id', link.course_id) : q.is('course_id', null);
  const { data: siblings } = await q;
  const list = siblings ?? [];
  const i = list.findIndex((l) => l.id === id);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= list.length) return ok(null);
  [list[i], list[j]] = [list[j], list[i]];
  const updates = list
    .map((l, index) => ({ id: l.id, sort_order: index, changed: l.sort_order !== index }))
    .filter((l) => l.changed);
  for (const u of updates) {
    const { error } = await supabase.from('links').update({ sort_order: u.sort_order }).eq('id', u.id);
    if (error) return err(error.message);
  }
  refreshAll();
  return ok(null);
}

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

export async function saveCourseNotes(courseId: string, text: string): Promise<ActionResult> {
  const parsed = z.object({ courseId: z.uuid(), text: z.string().max(20000) }).safeParse({ courseId, text });
  if (!parsed.success) return err('Notes are limited to 20,000 characters.');
  const { supabase } = await session();
  const { error } = await supabase
    .from('courses')
    .update({ info_notes: parsed.data.text.trim() || null })
    .eq('id', parsed.data.courseId);
  if (error) return err(error.message);
  refreshAll();
  return ok(null);
}
