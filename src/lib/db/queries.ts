import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from './server';
import type { Tables } from './types';

export type Course = Tables<'courses'>;
export type Item = Tables<'items'>;
export type Link = Tables<'links'>;
export type Term = Tables<'terms'>;
export type ItemChange = Tables<'item_changes'>;

/** The fields every list needs to draw a course mark. */
export type CourseLite = Pick<Course, 'id' | 'code' | 'slug' | 'title' | 'color' | 'color_dark' | 'ai_allowed'>;

export const COURSE_LITE = 'id, code, slug, title, color, color_dark, ai_allowed';

/**
 * Per-request context for every page in (app): the signed-in user, the current
 * term, and its courses. Wrapped in cache() so the layout and page share one fetch.
 */
export const getAppContext = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: terms } = await supabase
    .from('terms')
    .select('*')
    .order('is_current', { ascending: false })
    .order('starts_on', { ascending: false })
    .limit(1);
  const term = terms?.[0] ?? null;

  let courses: Course[] = [];
  if (term) {
    const { data } = await supabase
      .from('courses')
      .select('*')
      .eq('term_id', term.id)
      .eq('archived', false)
      .order('sort_order');
    courses = data ?? [];
  }

  return { supabase, user, term, courses };
});

export function toLite(course: Course): CourseLite {
  return {
    id: course.id,
    code: course.code,
    slug: course.slug,
    title: course.title,
    color: course.color,
    color_dark: course.color_dark,
    ai_allowed: course.ai_allowed,
  };
}

export async function getCourseBySlug(slug: string) {
  const ctx = await getAppContext();
  return ctx.courses.find((c) => c.slug === slug) ?? null;
}

export async function countNeedsYou() {
  const { supabase } = await getAppContext();
  const now = new Date().toISOString();
  const [proposals, reminders, runs] = await Promise.all([
    supabase.from('proposals').select('id', { count: 'exact', head: true }).eq('state', 'pending'),
    supabase
      .from('reminders')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'paste')
      .is('done_at', null)
      .lte('remind_at', now)
      .or(`snoozed_until.is.null,snoozed_until.lte.${now}`),
    supabase.from('sync_runs').select('source, ok, started_at').order('started_at', { ascending: false }).limit(200),
  ]);

  // A source is failing when its last three runs all failed.
  const bySource = new Map<string, boolean[]>();
  for (const run of runs.data ?? []) {
    const list = bySource.get(run.source) ?? [];
    if (list.length < 3) list.push(run.ok === false);
    bySource.set(run.source, list);
  }
  const failing = [...bySource.entries()]
    .filter(([, fails]) => fails.length === 3 && fails.every(Boolean))
    .map(([source]) => source);

  return { proposals: proposals.count ?? 0, pastes: reminders.count ?? 0, failing };
}
