import 'server-only';
import { serverEnv } from '@/env';
import type { ItemKind } from '@/config/term-f26';
import type { Json } from '@/lib/db/types';
import type { Admin } from '@/lib/jobs/queue';
import { describeChange } from '@/lib/items/changes';
import { EXAM_KINDS, sourceLabel } from '@/lib/items/labels';
import { isDone } from '@/lib/items/runway';
import { eventLabel } from '@/lib/reminders/events';
import { sourceHealth } from '@/lib/sync/summary';
import { addDaysToDate, toTorontoDate } from '@/lib/time';
import { buildDigest, type Digest, type DigestExam, type DigestItem } from './build';

const DAY = 86_400_000;

/** The one account: the Supabase user whose email is ALLOWED_EMAIL. */
export async function ownerUserId(admin: Admin): Promise<string | null> {
  const want = serverEnv.ALLOWED_EMAIL.toLowerCase();
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 50 });
  if (error) throw new Error(`Could not list users: ${error.message}`);
  return data.users.find((u) => u.email?.toLowerCase() === want)?.id ?? null;
}

/** Records contact from the Apps Script bridge; Settings, Integrations shows the latest. */
export async function recordBridgeContact(admin: Admin, userId: string, stats: Record<string, unknown>): Promise<void> {
  const now = new Date().toISOString();
  await admin
    .from('sync_runs')
    .insert({ user_id: userId, source: 'bridge', started_at: now, finished_at: now, ok: true, stats: stats as Json });
}

export async function loadDigest(admin: Admin, userId: string, now = new Date()): Promise<Digest> {
  const today = toTorontoDate(now);
  const tomorrow = addDaysToDate(today, 1);
  const weekEnd = addDaysToDate(today, 7);
  const from = new Date(now.getTime() - DAY).toISOString();
  const to = new Date(now.getTime() + 15 * DAY).toISOString();

  const [coursesRes, itemsRes, proposalsRes, remindersRes, runsRes, changesRes] = await Promise.all([
    admin.from('courses').select('id, code').eq('user_id', userId),
    admin
      .from('items')
      .select('id, course_id, kind, title, due_at, starts_at, time_known, progress, location, seat')
      .eq('user_id', userId)
      .eq('state', 'active')
      .or(`and(due_at.gte.${from},due_at.lte.${to}),and(due_at.is.null,starts_at.gte.${from},starts_at.lte.${to})`)
      .limit(500),
    admin.from('proposals').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('state', 'pending'),
    admin
      .from('reminders')
      .select('title, where_to_find, url, remind_at, snoozed_until')
      .eq('user_id', userId)
      .is('done_at', null)
      .lte('remind_at', new Date(now.getTime() + 12 * 3_600_000).toISOString())
      .order('remind_at')
      .limit(30),
    admin
      .from('sync_runs')
      .select('source, ok, started_at, finished_at, error, stats')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(300),
    admin
      .from('item_changes')
      .select('field, old_value, new_value, source, detected_at, items(title, course_id)')
      .eq('user_id', userId)
      .gte('detected_at', from)
      .neq('source', 'manual')
      .order('detected_at', { ascending: false })
      .limit(20),
  ]);
  for (const r of [coursesRes, itemsRes, remindersRes, runsRes, changesRes])
    if (r.error) throw new Error(`Could not load the digest: ${r.error.message}`);

  const code = new Map((coursesRes.data ?? []).map((c) => [c.id, c.code]));
  const label = (courseId: string | null, title: string) => eventLabel(courseId ? (code.get(courseId) ?? null) : null, title);

  const dueSoon: DigestItem[] = [];
  const nextWeek: DigestItem[] = [];
  const exams: DigestExam[] = [];
  for (const i of itemsRes.data ?? []) {
    const at = i.due_at ?? i.starts_at;
    if (!at || i.kind === 'break' || isDone(i.progress)) continue;
    const due = new Date(at);
    const date = toTorontoDate(due);
    const entry = { id: i.id, label: label(i.course_id, i.title), due, timeKnown: i.time_known };
    if (EXAM_KINDS.includes(i.kind as ItemKind)) {
      if (due > now && due.getTime() <= now.getTime() + 14 * DAY) exams.push({ ...entry, location: i.location, seat: i.seat });
      continue;
    }
    if (date < today || (i.time_known && due < now)) continue;
    if (date <= tomorrow) dueSoon.push(entry);
    else if (date <= weekEnd) nextWeek.push(entry);
  }
  const byDue = (a: DigestItem, b: DigestItem) => a.due.getTime() - b.due.getTime();

  const bySource = new Map<string, NonNullable<typeof runsRes.data>>();
  for (const r of runsRes.data ?? []) if (r.source !== 'bridge') bySource.set(r.source, [...(bySource.get(r.source) ?? []), r]);
  const failingSources = [...bySource.entries()].filter(([, runs]) => sourceHealth(runs).failStreak >= 3).map(([s]) => s);
  const pageIds = failingSources.filter((s) => s.startsWith('page_watch:')).map((s) => s.slice('page_watch:'.length));
  const pageNames = new Map<string, string>();
  if (pageIds.length) {
    const { data } = await admin.from('watched_pages').select('id, label, course_id').in('id', pageIds);
    for (const p of data ?? []) pageNames.set(`page_watch:${p.id}`, `${label(p.course_id, p.label)} page`);
  }

  const reminders = (remindersRes.data ?? [])
    .filter((r) => !r.snoozed_until || new Date(r.snoozed_until) <= now)
    .map((r) => ({ title: r.title, whereToFind: r.where_to_find, url: r.url }));

  return buildDigest({
    now,
    appUrl: serverEnv.APP_URL,
    dueSoon: dueSoon.sort(byDue),
    nextWeek: nextWeek.sort(byDue),
    exams: exams.sort(byDue),
    pendingProposals: proposalsRes.count ?? 0,
    reminders,
    failingSources: failingSources.map((s) => pageNames.get(s) ?? sourceLabel(s)),
    changes: (changesRes.data ?? []).map((c) => {
      const item = c.items as { title: string; course_id: string | null } | null;
      return describeChange(item ? label(item.course_id, item.title) : 'An item', c);
    }),
  });
}
