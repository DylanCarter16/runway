import type { SupabaseClient } from '@supabase/supabase-js';
import type { SeedTerm } from '@/config/term.template';
import type { Database, TablesInsert } from '@/lib/db/types';
import { canonical } from '@/lib/sync/items';
import { courseRow, itemRow, linkRows, pageRows, seedItemPatch, termRow } from './seed';

export interface ImportResult {
  termId: string;
  created: { courses: number; links: number; pages: number; items: number };
  updated: { courses: number; items: number };
}

type Client = SupabaseClient<Database>;

function fail(step: string, message: string): never {
  throw new Error(`Loading the term failed at ${step}: ${message}`);
}

/**
 * Idempotent import of a term config. New rows are inserted; seeded items and course
 * meetings that already exist are updated in place when the config changed, except
 * fields Dylan edited (items.locked_fields). Running it twice changes nothing.
 */
export async function importTerm(supabase: Client, term: SeedTerm, userId: string): Promise<ImportResult> {
  const created = { courses: 0, links: 0, pages: 0, items: 0 };
  const updated = { courses: 0, items: 0 };

  const t = await supabase
    .from('terms')
    .upsert(termRow(term, userId), { onConflict: 'user_id,code', ignoreDuplicates: true });
  if (t.error) fail('terms', t.error.message);
  const termSel = await supabase.from('terms').select('id').eq('user_id', userId).eq('code', term.code).single();
  if (termSel.error) fail('terms', termSel.error.message);
  const termId = termSel.data.id;

  const c = await supabase
    .from('courses')
    .upsert(
      term.courses.map((course, i) => courseRow(course, { userId, termId, sortOrder: i })),
      { onConflict: 'user_id,term_id,slug', ignoreDuplicates: true },
    )
    .select('id');
  if (c.error) fail('courses', c.error.message);
  created.courses = c.data.length;

  const courseSel = await supabase.from('courses').select('id, slug, meetings').eq('term_id', termId);
  if (courseSel.error) fail('courses', courseSel.error.message);
  const idBySlug = new Map(courseSel.data.map((row) => [row.slug, row.id]));

  // Class times come from the config (Dylan's Quest sections), so a changed section updates in place.
  for (const row of courseSel.data) {
    const course = term.courses.find((c) => c.slug === row.slug);
    if (!course) continue;
    const meetings = courseRow(course, { userId, termId, sortOrder: 0 }).meetings;
    if (canonical(row.meetings) === canonical(meetings)) continue;
    const u = await supabase.from('courses').update({ meetings }).eq('id', row.id);
    if (u.error) fail('courses', u.error.message);
    updated.courses++;
  }

  const links = linkRows(term.globalLinks, { userId, courseId: null });
  const pages: TablesInsert<'watched_pages'>[] = [];
  const items = term.termItems.map((item) => itemRow(item, { userId, courseId: null, sourceUrl: null }));
  for (const course of term.courses) {
    const courseId = idBySlug.get(course.slug);
    if (!courseId) fail('courses', `no row for ${course.code}`);
    links.push(...linkRows(course.links, { userId, courseId }));
    pages.push(...pageRows(course.watchedPages, { userId, courseId }));
    const sourceUrl = course.outlineUrl ?? course.siteUrl;
    items.push(...course.seedItems.map((item) => itemRow(item, { userId, courseId, sourceUrl })));
  }

  const l = await supabase
    .from('links')
    .upsert(links, { onConflict: 'user_id,course_id,url', ignoreDuplicates: true })
    .select('id');
  if (l.error) fail('links', l.error.message);
  created.links = l.data.length;

  if (pages.length) {
    const p = await supabase
      .from('watched_pages')
      .upsert(pages, { onConflict: 'user_id,url', ignoreDuplicates: true })
      .select('id');
    if (p.error) fail('watched pages', p.error.message);
    created.pages = p.data.length;
  }

  const it = await supabase
    .from('items')
    .upsert(items, { onConflict: 'user_id,source,source_ref', ignoreDuplicates: true })
    .select('id');
  if (it.error) fail('items', it.error.message);
  created.items = it.data.length;

  // Items loaded before a config change are updated in place, except fields Dylan locked.
  const existing = await supabase
    .from('items')
    .select(
      'id, source_ref, kind, title, description, due_at, starts_at, ends_at, all_day, time_known, weight_percent, location, flags, source_url, locked_fields',
    )
    .eq('user_id', userId)
    .eq('source', 'seed');
  if (existing.error) fail('items', existing.error.message);
  const rowByRef = new Map(items.map((row) => [row.source_ref, row]));
  for (const row of existing.data) {
    const next = row.source_ref ? rowByRef.get(row.source_ref) : undefined;
    if (!next) continue;
    const patch = seedItemPatch(row, next);
    if (!patch) continue;
    const u = await supabase.from('items').update(patch).eq('id', row.id);
    if (u.error) fail('items', u.error.message);
    updated.items++;
  }

  const s = await supabase
    .from('settings')
    .upsert({ user_id: userId, timezone: term.timezone }, { onConflict: 'user_id', ignoreDuplicates: true });
  if (s.error) fail('settings', s.error.message);

  return { termId, created, updated };
}
