import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types';
import { toTorontoDate } from '@/lib/time';
import { readScope, type AskScope, type ScopeOptions } from './scope';

// Data for the Ask pages: the scope picker and the thread list. RLS scopes
// every read to the signed-in user.

type Db = SupabaseClient<Database>;

export async function loadScopeOptions(db: Db): Promise<ScopeOptions> {
  const { data: courses } = await db
    .from('courses')
    .select('id, code, slug, ai_policy, outline_url')
    .eq('ai_allowed', true)
    .eq('archived', false)
    .order('sort_order');
  const ids = (courses ?? []).map((c) => c.id);
  if (!ids.length) return { courses: [], notes: [], items: [] };
  const [{ data: notes }, { data: items }] = await Promise.all([
    db.from('notes').select('id, title, course_id, lecture_on, original_md').in('course_id', ids).order('lecture_on', { ascending: false, nullsFirst: false }).limit(100),
    db
      .from('items')
      .select('id, title, kind, course_id, due_at, starts_at')
      .in('course_id', ids)
      .eq('state', 'active')
      .neq('kind', 'break')
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(150),
  ]);
  return {
    courses: courses ?? [],
    notes: (notes ?? []).map((n) => ({
      id: n.id,
      title: n.title ?? (n.original_md.split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean) ?? 'Untitled note').slice(0, 80),
      courseId: n.course_id!,
      lectureOn: n.lecture_on,
    })),
    items: (items ?? []).map((i) => {
      const at = i.due_at ?? i.starts_at;
      return { id: i.id, title: i.title, kind: i.kind, courseId: i.course_id!, date: at ? toTorontoDate(new Date(at)) : null };
    }),
  };
}

export interface ThreadRow {
  id: string;
  title: string;
  scope: AskScope;
  courseId: string | null;
  updatedAt: string;
}

export async function loadThreads(db: Db, courseId?: string, limit = 50): Promise<ThreadRow[]> {
  let q = db.from('ask_threads').select('id, title, scope, course_id, updated_at');
  if (courseId) q = q.eq('course_id', courseId);
  const { data } = await q.order('updated_at', { ascending: false }).limit(limit);
  return (data ?? []).map((t) => ({ id: t.id, title: t.title ?? 'Untitled question', scope: readScope(t.scope), courseId: t.course_id, updatedAt: t.updated_at }));
}
