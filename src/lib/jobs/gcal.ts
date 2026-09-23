import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { serverEnv } from '@/env';
import type { ItemKind } from '@/config/term-f26';
import { decryptSecret, encryptSecret } from '@/lib/crypto';
import { createAdminClient } from '@/lib/db/admin';
import type { Json } from '@/lib/db/types';
import { CalendarGoneError, exchangeGoogleCode, GoogleReauthError, googleCalendarApi, googleConfigured } from '@/lib/gcal/google';
import { applyDiff, diffCalendar, RUNWAY_CALENDAR_NAME, toDesired, totalWrites, type CalendarApi, type RemoteEvent } from '@/lib/gcal/sync';
import { planReminderWrites, reminderCatalog } from '@/lib/reminders/catalog';
import { planItemEvents, planReminderEvent, type PlannedEvent } from '@/lib/reminders/events';
import { ITEM_KIND_VALUES, type RuleOverrides } from '@/lib/reminders/rules';
import { TIME_ZONE } from '@/lib/time';
import { enqueue, type Admin, type Job } from './queue';
import { withSyncRun } from './sync';

// Google Calendar sync and the reminder generator (docs/PHASES.md Phase 4).
// A database trigger queues reminders.generate when an item changes and gcal.sync
// when a reminder changes; the daily cron runs both as the nightly reconcile.

export const JOB_GCAL_SYNC = 'gcal.sync';
export const JOB_REMINDERS = 'reminders.generate';
const SYNC_BUDGET_MS = 40_000;

// ---------------------------------------------------------------------------
// Stored connection (integration_tokens, provider google)
// ---------------------------------------------------------------------------

export interface GoogleMeta {
  calendar_id?: string;
  calendar_name?: string;
  connected_at?: string;
  last_sync_at?: string;
  last_sync_writes?: number;
  last_error?: string | null;
}

export interface GoogleStatus {
  configured: boolean;
  connected: boolean;
  status: 'ok' | 'reauth_required' | 'error' | null;
  meta: GoogleMeta;
}

function key(): string {
  const k = serverEnv.TOKEN_ENCRYPTION_KEY;
  if (!k) throw new Error('TOKEN_ENCRYPTION_KEY is not set, so secrets cannot be stored.');
  return k;
}

async function readGoogle(admin: Admin, userId: string) {
  const { data, error } = await admin
    .from('integration_tokens')
    .select('secret_ciphertext, meta, status')
    .eq('user_id', userId)
    .eq('provider', 'google')
    .maybeSingle();
  if (error) throw new Error(`Could not read the Google connection: ${error.message}`);
  if (!data) return null;
  return {
    refreshToken: () => decryptSecret(data.secret_ciphertext, key()),
    meta: (data.meta ?? {}) as GoogleMeta,
    status: data.status as GoogleStatus['status'],
  };
}

async function updateGoogle(admin: Admin, userId: string, patch: { meta?: GoogleMeta; status?: 'ok' | 'reauth_required' | 'error' }) {
  await admin
    .from('integration_tokens')
    .update({
      ...(patch.meta ? { meta: patch.meta as Json } : {}),
      ...(patch.status ? { status: patch.status } : {}),
    })
    .eq('user_id', userId)
    .eq('provider', 'google');
}

export async function googleStatus(userId: string): Promise<GoogleStatus> {
  const row = await readGoogle(createAdminClient(), userId);
  return {
    configured: googleConfigured(),
    connected: Boolean(row),
    status: row?.status ?? null,
    meta: row?.meta ?? {},
  };
}

/** OAuth callback: store the refresh token encrypted, make sure the Runway calendar exists, queue a sync. */
export async function connectGoogle(userId: string, code: string, redirectUri: string): Promise<void> {
  const admin = createAdminClient();
  const { refreshToken, scopes } = await exchangeGoogleCode(code, redirectUri);
  const previous = await readGoogle(admin, userId);
  const meta: GoogleMeta = {
    ...(previous?.meta ?? {}),
    connected_at: new Date().toISOString(),
    last_error: null,
  };
  const api = googleCalendarApi(refreshToken);
  meta.calendar_id = await ensureCalendar(api, meta.calendar_id);
  meta.calendar_name = RUNWAY_CALENDAR_NAME;
  const { error } = await admin.from('integration_tokens').upsert(
    {
      user_id: userId,
      provider: 'google',
      secret_ciphertext: encryptSecret(refreshToken, key()),
      scopes,
      meta: meta as Json,
      status: 'ok',
    },
    { onConflict: 'user_id,provider' },
  );
  if (error) throw new Error(`Could not save the Google connection: ${error.message}`);
  await enqueue(admin, {
    userId,
    type: JOB_REMINDERS,
    dedupeKey: 'reminders:generate',
  });
}

/** Forgets the token. The Runway calendar stays in Google with its events. */
export async function disconnectGoogle(userId: string): Promise<void> {
  const admin = createAdminClient();
  await admin.from('integration_tokens').delete().eq('user_id', userId).eq('provider', 'google');
}

export async function queueCalendarSync(userId: string): Promise<boolean> {
  return enqueue(createAdminClient(), {
    userId,
    type: JOB_GCAL_SYNC,
    dedupeKey: 'gcal:sync',
  });
}

/** A calendar id that still works, creating the Runway calendar when there is none. */
async function ensureCalendar(api: CalendarApi, calendarId: string | undefined): Promise<string> {
  if (calendarId) {
    try {
      await api.listEvents(calendarId);
      return calendarId;
    } catch (e) {
      if (!(e instanceof CalendarGoneError)) throw e;
    }
  }
  return api.createCalendar(RUNWAY_CALENDAR_NAME, TIME_ZONE);
}

// ---------------------------------------------------------------------------
// What the calendar should hold
// ---------------------------------------------------------------------------

const overridesSchema = z.record(
  z.enum(ITEM_KIND_VALUES),
  z.object({
    prepDays: z.number().int().min(0).max(60).optional(),
    reminders: z.array(z.number().int().min(0).max(40320)).max(5).optional(),
  }),
);

export function parseOverrides(value: unknown): RuleOverrides {
  const parsed = overridesSchema.safeParse(value ?? {});
  return parsed.success ? (parsed.data as RuleOverrides) : {};
}

async function loadSettings(admin: Admin, userId: string) {
  const { data } = await admin.from('settings').select('study_block_hour, reminder_rules').eq('user_id', userId).maybeSingle();
  return {
    studyBlockHour: data?.study_block_hour ?? 19,
    overrides: parseOverrides(data?.reminder_rules),
  };
}

async function desiredEvents(admin: Admin, userId: string) {
  const [settings, coursesRes, itemsRes, remindersRes] = await Promise.all([
    loadSettings(admin, userId),
    admin.from('courses').select('id, code, slug').eq('user_id', userId),
    admin
      .from('items')
      .select(
        'id, course_id, kind, title, due_at, starts_at, ends_at, all_day, time_known, location, seat, state, progress, created_at, source_url, prep_days, reminder_minutes, gcal_event_id, gcal_prep_event_ids, gcal_synced_hash',
      )
      .eq('user_id', userId)
      .eq('state', 'active')
      .or('due_at.not.is.null,starts_at.not.is.null')
      .limit(5000),
    admin
      .from('reminders')
      .select('id, title, where_to_find, url, remind_at, snoozed_until, done_at, gcal_event_id, gcal_synced_hash')
      .eq('user_id', userId)
      .is('done_at', null)
      .limit(5000),
  ]);
  for (const r of [coursesRes, itemsRes, remindersRes]) if (r.error) throw new Error(`Could not load calendar data: ${r.error.message}`);
  const courses = new Map((coursesRes.data ?? []).map((c) => [c.id, c]));
  const ctx = { appUrl: serverEnv.APP_URL, ...settings };

  const planned: PlannedEvent[] = [];
  for (const item of itemsRes.data ?? []) {
    const course = item.course_id ? courses.get(item.course_id) : undefined;
    planned.push(
      ...planItemEvents(
        {
          ...item,
          kind: item.kind as ItemKind,
          courseCode: course?.code ?? null,
          courseSlug: course?.slug ?? null,
        },
        ctx,
      ),
    );
  }
  for (const r of remindersRes.data ?? []) {
    const e = planReminderEvent(r, serverEnv.APP_URL);
    if (e) planned.push(e);
  }
  return {
    planned,
    items: itemsRes.data ?? [],
    reminders: remindersRes.data ?? [],
  };
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

function ownerHash(hashes: string[]): string {
  return createHash('sha256').update(hashes.join('|')).digest('hex').slice(0, 32);
}

/** Keeps items.gcal_* and reminders.gcal_* in step with the calendar (bookkeeping only). */
async function recordEventIds(
  admin: Admin,
  userId: string,
  desired: ReturnType<typeof toDesired>[],
  ids: Map<string, string>,
  loaded: Awaited<ReturnType<typeof desiredEvents>>,
) {
  const byOwner = new Map<string, ReturnType<typeof toDesired>[]>();
  for (const d of desired) {
    const k = `${d.planned.owner.table}:${d.planned.owner.id}`;
    byOwner.set(k, [...(byOwner.get(k) ?? []), d]);
  }
  const now = new Date().toISOString();
  for (const item of loaded.items) {
    const events = byOwner.get(`items:${item.id}`) ?? [];
    const main = events.find((e) => e.planned.owner.main);
    const eventId = main ? (ids.get(main.planned.runwayId) ?? null) : null;
    const prepIds = events
      .filter((e) => !e.planned.owner.main)
      .map((e) => ids.get(e.planned.runwayId))
      .filter((x): x is string => Boolean(x));
    const hash = events.length ? ownerHash(events.map((e) => e.hash)) : null;
    if (item.gcal_event_id === eventId && item.gcal_synced_hash === hash && item.gcal_prep_event_ids.join() === prepIds.join()) continue;
    await admin
      .from('items')
      .update({
        gcal_event_id: eventId,
        gcal_prep_event_ids: prepIds,
        gcal_synced_hash: hash,
        gcal_synced_at: now,
      })
      .eq('id', item.id);
  }
  for (const r of loaded.reminders) {
    const d = byOwner.get(`reminders:${r.id}`)?.[0];
    const eventId = d ? (ids.get(d.planned.runwayId) ?? null) : null;
    const hash = d?.hash ?? null;
    if (r.gcal_event_id === eventId && r.gcal_synced_hash === hash) continue;
    await admin.from('reminders').update({ gcal_event_id: eventId, gcal_synced_hash: hash }).eq('id', r.id);
  }
  // Dismissed items and closed reminders no longer have events.
  await admin
    .from('items')
    .update({
      gcal_event_id: null,
      gcal_prep_event_ids: [],
      gcal_synced_hash: null,
      gcal_synced_at: now,
    })
    .eq('user_id', userId)
    .eq('state', 'dismissed')
    .not('gcal_synced_hash', 'is', null);
  await admin
    .from('reminders')
    .update({ gcal_event_id: null, gcal_synced_hash: null })
    .eq('user_id', userId)
    .not('done_at', 'is', null)
    .not('gcal_event_id', 'is', null);
}

export async function calendarSyncJob(admin: Admin, job: Job): Promise<void> {
  const userId = job.user_id;
  const conn = await readGoogle(admin, userId);
  if (!conn || conn.status === 'reauth_required' || !googleConfigured()) return;
  const started = Date.now();
  const meta: GoogleMeta = { ...conn.meta };

  try {
    await withSyncRun(admin, userId, 'gcal', async () => {
      const api = googleCalendarApi(conn.refreshToken());
      if (!meta.calendar_id) meta.calendar_id = await api.createCalendar(RUNWAY_CALENDAR_NAME, TIME_ZONE);
      const loaded = await desiredEvents(admin, userId);
      const desired = loaded.planned.map(toDesired);

      let remote: RemoteEvent[];
      try {
        remote = await api.listEvents(meta.calendar_id);
      } catch (e) {
        if (!(e instanceof CalendarGoneError)) throw e;
        meta.calendar_id = await api.createCalendar(RUNWAY_CALENDAR_NAME, TIME_ZONE);
        remote = [];
      }
      const result = await applyDiff(api, meta.calendar_id, diffCalendar(desired, remote), { deadline: started + SYNC_BUDGET_MS });
      await recordEventIds(admin, userId, desired, result.ids, loaded);
      if (!result.complete) {
        await enqueue(admin, {
          userId,
          type: JOB_GCAL_SYNC,
          dedupeKey: 'gcal:sync:more',
        });
      }
      Object.assign(meta, {
        last_sync_at: new Date().toISOString(),
        last_sync_writes: totalWrites(result),
        last_error: null,
      });
      await updateGoogle(admin, userId, { meta, status: 'ok' });
      return {
        events: desired.length,
        inserted: result.inserted,
        updated: result.updated,
        removed: result.removed,
        complete: result.complete,
      };
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    meta.last_error = message.slice(0, 500);
    if (e instanceof GoogleReauthError) {
      // No retry: nothing works until Dylan reconnects.
      await updateGoogle(admin, userId, { meta, status: 'reauth_required' });
      return;
    }
    await updateGoogle(admin, userId, { meta });
    throw e;
  }
}

/** Writes the paste reminder catalog. Returns how many rows changed. */
export async function generateReminders(admin: Admin, userId: string, now = new Date()): Promise<number> {
  const { data: term } = await admin
    .from('terms')
    .select('id, code, starts_on, ends_on')
    .eq('user_id', userId)
    .eq('is_current', true)
    .maybeSingle();
  if (!term) return 0;

  const [coursesRes, linksRes, examsRes, finalsRes, existingRes] = await Promise.all([
    admin.from('courses').select('id, slug, code, meetings, external_ids').eq('user_id', userId).eq('term_id', term.id),
    admin.from('links').select('course_id, url').eq('user_id', userId).ilike('url', '%piazza.com%'),
    admin
      .from('items')
      .select('id, course_id, kind, title, due_at, starts_at, seat')
      .eq('user_id', userId)
      .eq('state', 'active')
      .in('kind', ['midterm', 'final'])
      .or('due_at.not.is.null,starts_at.not.is.null'),
    admin.from('items').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('kind', 'final').eq('source', 'open_data'),
    admin
      .from('reminders')
      .select('id, dedupe_key, title, where_to_find, url, remind_at, course_id, item_id, done_at')
      .eq('user_id', userId),
  ]);
  for (const r of [coursesRes, linksRes, examsRes, existingRes])
    if (r.error) throw new Error(`Could not load reminder data: ${r.error.message}`);

  const courses = coursesRes.data ?? [];
  const codeById = new Map(courses.map((c) => [c.id, c.code]));
  let classesEndOn = term.starts_on;
  for (const c of courses) {
    for (const m of (c.meetings ?? []) as {
      component?: string;
      ends_on?: string;
    }[]) {
      if (m.component === 'LEC' && m.ends_on && m.ends_on > classesEndOn) classesEndOn = m.ends_on;
    }
  }
  if (classesEndOn === term.starts_on) classesEndOn = term.ends_on;

  const drafts = reminderCatalog({
    term: { code: term.code, startsOn: term.starts_on, endsOn: term.ends_on },
    classesEndOn,
    courses: courses.map((c) => ({
      id: c.id,
      slug: c.slug,
      code: c.code,
      hasMeetings: Array.isArray(c.meetings) && c.meetings.length > 0,
      usesLearn: (((c.external_ids ?? {}) as { learn_names?: string[] }).learn_names ?? []).length > 0,
      piazzaUrl: (linksRes.data ?? []).find((l) => l.course_id === c.id)?.url ?? null,
    })),
    exams: (examsRes.data ?? []).map((e) => ({
      id: e.id,
      courseId: e.course_id,
      courseCode: e.course_id ? (codeById.get(e.course_id) ?? null) : null,
      kind: e.kind as 'midterm' | 'final',
      title: e.title,
      at: (e.starts_at ?? e.due_at)!,
      seat: e.seat,
    })),
    finalsImported: (finalsRes.count ?? 0) > 0,
    now,
  });

  const writes = planReminderWrites(existingRes.data ?? [], drafts, now);
  if (writes.inserts.length) {
    const { error } = await admin.from('reminders').upsert(
      writes.inserts.map((d) => ({
        dedupe_key: d.dedupe_key,
        kind: d.kind,
        paste_kind: d.paste_kind,
        title: d.title,
        where_to_find: d.where_to_find,
        url: d.url,
        remind_at: d.remind_at,
        course_id: d.course_id,
        item_id: d.item_id,
        user_id: userId,
      })),
      { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true },
    );
    if (error) throw new Error(`Could not save reminders: ${error.message}`);
  }
  for (const u of writes.updates) {
    const { error } = await admin.from('reminders').update(u.patch).eq('id', u.id);
    if (error) throw new Error(`Could not update a reminder: ${error.message}`);
  }
  return writes.inserts.length + writes.updates.length;
}

export async function remindersJob(admin: Admin, job: Job): Promise<void> {
  await generateReminders(admin, job.user_id);
  const conn = await readGoogle(admin, job.user_id);
  if (conn && conn.status !== 'reauth_required' && googleConfigured()) {
    const queued = await enqueue(admin, {
      userId: job.user_id,
      type: JOB_GCAL_SYNC,
      dedupeKey: 'gcal:sync',
    });
    // A sync already running may have read the items before this change: run once more after it.
    if (!queued) {
      await enqueue(admin, {
        userId: job.user_id,
        type: JOB_GCAL_SYNC,
        dedupeKey: 'gcal:sync:next',
        runAfter: new Date(Date.now() + 60_000),
      });
    }
  }
}

export const GCAL_HANDLERS = {
  [JOB_GCAL_SYNC]: calendarSyncJob,
  [JOB_REMINDERS]: remindersJob,
};
