import 'server-only';
import { serverEnv } from '@/env';
import { createAdminClient } from '@/lib/db/admin';
import { enqueue, processJobs, type Admin, type JobHandler } from './queue';
import type { RunTarget } from './types';
import { GCAL_HANDLERS, JOB_REMINDERS } from './gcal';
import { INBOX_HANDLERS } from './inbox';
import { NOTE_HANDLERS } from './notes';
import { JOB_SYNC_LEARN, JOB_SYNC_OPEN_DATA, JOB_SYNC_PAGE, SYNC_HANDLERS } from './sync';

// What each cron cadence runs (docs/SOURCES.md, Summary table), and the "Run now" entry point.

export type Cadence = 'hourly' | 'every_3h' | 'daily';

export const HANDLERS: Record<string, JobHandler> = { ...SYNC_HANDLERS, ...INBOX_HANDLERS, ...GCAL_HANDLERS, ...NOTE_HANDLERS };

export function runQueuedJobs(admin: Admin) {
  return processJobs(admin, HANDLERS);
}

/** Runs ready jobs right away (from after() in a user-facing route), logging instead of throwing. */
export async function runWorkerNow(): Promise<void> {
  try {
    await runQueuedJobs(createAdminClient());
  } catch (e) {
    console.error('job worker failed:', e instanceof Error ? e.message : e);
  }
}

/** Users with a current term: the one account in practice. */
async function activeUsers(admin: Admin): Promise<string[]> {
  const { data, error } = await admin.from('terms').select('user_id').eq('is_current', true);
  if (error) throw new Error(`Could not read terms: ${error.message}`);
  return [...new Set((data ?? []).map((t) => t.user_id))];
}

async function hasLearnFeed(admin: Admin, userId: string): Promise<boolean> {
  const { count } = await admin
    .from('integration_tokens')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('provider', 'learn_ics');
  return Boolean(count);
}

export function pageJob(userId: string, pageId: string) {
  return { userId, type: JOB_SYNC_PAGE, payload: { pageId }, dedupeKey: `sync:page:${pageId}` };
}

export function learnJob(userId: string) {
  return { userId, type: JOB_SYNC_LEARN, dedupeKey: 'sync:learn_ics' };
}

export function openDataJob(userId: string) {
  return { userId, type: JOB_SYNC_OPEN_DATA, dedupeKey: 'sync:open_data' };
}

/** Enqueues every sync for a cadence. Sources without their secret are skipped, not failed. */
export async function enqueueCadence(admin: Admin, cadence: Cadence): Promise<number> {
  let queued = 0;
  for (const userId of await activeUsers(admin)) {
    const { data: pages, error } = await admin
      .from('watched_pages')
      .select('id')
      .eq('user_id', userId)
      .eq('enabled', true)
      .eq('cadence', cadence);
    if (error) throw new Error(`Could not read watched pages: ${error.message}`);
    for (const p of pages ?? []) if (await enqueue(admin, pageJob(userId, p.id))) queued++;

    if (cadence === 'hourly' && (await hasLearnFeed(admin, userId))) {
      if (await enqueue(admin, learnJob(userId))) queued++;
    }
    if (cadence === 'daily' && serverEnv.UW_OPENDATA_API_KEY) {
      if (await enqueue(admin, openDataJob(userId))) queued++;
    }
    // Nightly: refresh the paste reminders, then reconcile the whole Google calendar
    // (the reminders job queues the calendar sync when Google is connected).
    if (cadence === 'daily') {
      if (await enqueue(admin, { userId, type: JOB_REMINDERS, dedupeKey: 'reminders:generate' })) queued++;
    }
  }
  return queued;
}

/** "Run now" from Settings, Sync. Returns how many jobs were queued. */
export async function enqueueNow(admin: Admin, userId: string, target: RunTarget): Promise<number> {
  const jobs = [];
  if (target.kind === 'page') jobs.push(pageJob(userId, target.pageId));
  if (target.kind === 'learn_ics') jobs.push(learnJob(userId));
  if (target.kind === 'open_data') jobs.push(openDataJob(userId));
  // Reminders first; that job queues the calendar sync when Google is connected.
  if (target.kind === 'calendar') jobs.push({ userId, type: JOB_REMINDERS, dedupeKey: 'reminders:generate' });
  if (target.kind === 'all') {
    const { data: pages } = await admin.from('watched_pages').select('id').eq('user_id', userId).eq('enabled', true);
    for (const p of pages ?? []) jobs.push(pageJob(userId, p.id));
    if (await hasLearnFeed(admin, userId)) jobs.push(learnJob(userId));
    if (serverEnv.UW_OPENDATA_API_KEY) jobs.push(openDataJob(userId));
  }
  let queued = 0;
  for (const j of jobs) if (await enqueue(admin, j)) queued++;
  return queued;
}
