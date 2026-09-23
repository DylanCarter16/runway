import 'server-only';
import { z } from 'zod';
import { serverEnv } from '@/env';
import type { Json } from '@/lib/db/types';
import { parseCs251Assignments } from '@/lib/sources/cs251-assignments';
import { parseCs251ExamInfo } from '@/lib/sources/cs251-examinfo';
import { parseCs251Schedule } from '@/lib/sources/cs251-schedule';
import { FetchError, politeFetch, runwayUserAgent } from '@/lib/sources/fetch';
import { parseLearnIcs } from '@/lib/sources/learn-ics';
import {
  examRowSchema,
  fetchOpenData,
  importantDateSchema,
  mapExamRows,
  mapImportantDates,
  mapTerm,
} from '@/lib/sources/open-data';
import { diffPageText, normalizePageText, sha256 } from '@/lib/sources/page-watch';
import { syncCs251Assignments, syncCs251ExamInfo, syncCs251Schedule } from '@/lib/sync/cs251';
import { emptyStats, proposeUnmatched, syncItems, type SyncStats } from '@/lib/sync/items';
import { supabaseItemStore } from './item-store';
import { summarizeDiffJob } from './inbox';
import { enqueue, type Admin, type Job } from './queue';
import { readLearnFeed, updateLearnFeedMeta } from './tokens';

// Job handlers for the automatic sources (docs/SOURCES.md sections 1 to 4 and 7).
// Each run writes a sync_runs row; a thrown error marks the run failed and lets the
// queue retry with backoff.

export const JOB_SYNC_PAGE = 'sync.page';
export const JOB_SYNC_LEARN = 'sync.learn_ics';
export const JOB_SYNC_OPEN_DATA = 'sync.open_data';

/** sync_runs.source for a watched page: its parser, or page_watch:<id> for plain diff pages. */
export function pageRunSource(page: { id: string; parser: string }): string {
  return page.parser === 'diff' ? `page_watch:${page.id}` : page.parser;
}

function userAgent(): string {
  return runwayUserAgent(serverEnv.ALLOWED_EMAIL);
}

type RunStats = Record<string, unknown>;

async function withSyncRun(admin: Admin, userId: string, source: string, fn: () => Promise<RunStats>): Promise<void> {
  const { data: run, error } = await admin.from('sync_runs').insert({ user_id: userId, source }).select('id').single();
  if (error) throw new Error(`Could not record the sync run: ${error.message}`);
  try {
    const stats = await fn();
    await admin
      .from('sync_runs')
      .update({ finished_at: new Date().toISOString(), ok: true, stats: stats as Json })
      .eq('id', run.id);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await admin
      .from('sync_runs')
      .update({ finished_at: new Date().toISOString(), ok: false, error: message.slice(0, 1000) })
      .eq('id', run.id);
    throw e;
  }
}

async function currentTerm(admin: Admin, userId: string) {
  const { data, error } = await admin
    .from('terms')
    .select('id, code, name, starts_on, ends_on')
    .eq('user_id', userId)
    .eq('is_current', true)
    .order('starts_on', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not read the term: ${error.message}`);
  if (!data) throw new Error('No current term. Load the Fall 2026 setup in Settings, Term.');
  return data;
}

async function termCourses(admin: Admin, termId: string) {
  const { data, error } = await admin
    .from('courses')
    .select('id, code, slug, external_ids, meetings')
    .eq('term_id', termId)
    .eq('archived', false);
  if (error) throw new Error(`Could not read courses: ${error.message}`);
  return data ?? [];
}

function stats(s: SyncStats): RunStats {
  return { ...s };
}

// ---------------------------------------------------------------------------
// Watched pages (CS 246 and CS 251), with the CS 251 parsers
// ---------------------------------------------------------------------------

const pagePayload = z.object({ pageId: z.uuid() });

export async function syncPageJob(admin: Admin, job: Job): Promise<void> {
  const { pageId } = pagePayload.parse(job.payload);
  const { data: page, error } = await admin
    .from('watched_pages')
    .select('*')
    .eq('id', pageId)
    .eq('user_id', job.user_id)
    .maybeSingle();
  if (error) throw new Error(`Could not read the watched page: ${error.message}`);
  if (!page || !page.enabled) return;

  const checkedAt = new Date().toISOString();
  await withSyncRun(admin, job.user_id, pageRunSource(page), async () => {
    try {
      const res = await politeFetch(page.url, { userAgent: userAgent(), etag: page.etag, lastModified: page.last_modified });
      if (res.notModified) {
        await admin.from('watched_pages').update({ last_checked_at: checkedAt, last_error: null }).eq('id', page.id);
        return { notModified: true };
      }
      if (!res.ok) throw new FetchError(`${page.label} answered HTTP ${res.status}.`);

      const text = normalizePageText(res.body);
      const hash = sha256(text);
      const changed = hash !== page.last_hash;
      let snapshot: string | null = null;
      if (changed) snapshot = await storeSnapshot(admin, page, res.body, text, hash);
      if (snapshot && page.course_id) await queueDiffSummary(admin, job.user_id, page.course_id, snapshot);

      let parsed: RunStats = {};
      if (page.parser !== 'diff') parsed = await runPageParser(admin, job.user_id, page, res.body);

      await admin
        .from('watched_pages')
        .update({
          etag: res.etag,
          last_modified: res.lastModified,
          last_hash: hash,
          last_checked_at: checkedAt,
          ...(changed ? { last_changed_at: checkedAt } : {}),
          last_error: null,
        })
        .eq('id', page.id);
      return { changed, snapshot, ...parsed };
    } catch (e) {
      await admin
        .from('watched_pages')
        .update({ last_checked_at: checkedAt, last_error: e instanceof Error ? e.message : String(e) })
        .eq('id', page.id);
      throw e;
    }
  });
}

/** AI-on courses get a Claude summary of the change; the job itself checks the switch again. */
async function queueDiffSummary(admin: Admin, userId: string, courseId: string, documentId: string) {
  const { data: course } = await admin.from('courses').select('ai_allowed').eq('id', courseId).maybeSingle();
  const { data: doc } = await admin.from('documents').select('meta').eq('id', documentId).maybeSingle();
  const hasDiff = Boolean((doc?.meta as { diff?: unknown } | null)?.diff);
  if (course?.ai_allowed && hasDiff) await enqueue(admin, summarizeDiffJob(userId, documentId));
}

type PageRow = { id: string; user_id: string; course_id: string | null; url: string; label: string; parser: string };

/** Stores a page_snapshot document with the diff against the previous one. */
async function storeSnapshot(admin: Admin, page: PageRow, html: string, text: string, hash: string): Promise<string | null> {
  const { data: prev } = await admin
    .from('documents')
    .select('id, raw_text')
    .eq('user_id', page.user_id)
    .eq('kind', 'page_snapshot')
    .eq('source_ref', page.url)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const diff = prev ? diffPageText(prev.raw_text, text) : null;
  const { data, error } = await admin
    .from('documents')
    .insert({
      user_id: page.user_id,
      course_id: page.course_id,
      kind: 'page_snapshot',
      title: `${page.label} page`,
      source_url: page.url,
      source_ref: page.url,
      raw_text: text,
      raw_html: html,
      content_hash: hash,
      meta: { page_id: page.id, label: page.label, previous_document_id: prev?.id ?? null, diff } as Json,
    })
    .select('id')
    .single();
  // The page went back to text stored earlier: that snapshot already exists.
  if (error?.code === '23505') return null;
  if (error) throw new Error(`Could not store the page snapshot: ${error.message}`);
  return data.id;
}

async function runPageParser(admin: Admin, userId: string, page: PageRow, html: string): Promise<RunStats> {
  const term = await currentTerm(admin, userId);
  const ctx = { pageUrl: page.url, termYear: Number(term.starts_on.slice(0, 4)) };
  const store = supabaseItemStore(admin, userId);
  switch (page.parser) {
    case 'cs251_schedule': {
      const events = parseCs251Schedule(html, ctx);
      if (!events.length) throw new Error('The CS 251 schedule parser found no events. The page layout may have changed.');
      return stats(await syncCs251Schedule(store, events, page.course_id, page.url, new Date()));
    }
    case 'cs251_examinfo':
      return stats(await syncCs251ExamInfo(store, parseCs251ExamInfo(html, ctx), page.course_id, page.url));
    case 'cs251_assignments':
      return stats(await syncCs251Assignments(store, parseCs251Assignments(html, ctx), page.course_id));
    default:
      return {};
  }
}

// ---------------------------------------------------------------------------
// LEARN calendar feed
// ---------------------------------------------------------------------------

export async function syncLearnJob(admin: Admin, job: Job): Promise<void> {
  await withSyncRun(admin, job.user_id, 'learn_ics', async () => {
    const feed = await readLearnFeed(admin, job.user_id);
    if (!feed) return { skipped: 'no feed URL saved' };
    try {
      const res = await politeFetch(feed.url, {
        userAgent: userAgent(),
        etag: feed.meta.etag as string | undefined,
        lastModified: feed.meta.last_modified as string | undefined,
      });
      if (res.notModified) return { notModified: true };
      if (!res.ok) {
        throw new FetchError(
          `The LEARN feed answered HTTP ${res.status}. Copy the feed URL again from LEARN, Calendar, Subscribe, and save it in Settings, Integrations.`,
        );
      }
      const term = await currentTerm(admin, job.user_id);
      const courses = (await termCourses(admin, term.id)).map((c) => ({
        id: c.id,
        learnNames: ((c.external_ids as { learn_names?: string[] })?.learn_names ?? []).filter(Boolean),
      }));
      const parsed = parseLearnIcs(res.body, courses, { startsOn: term.starts_on, endsOn: term.ends_on });
      const store = supabaseItemStore(admin, job.user_id);
      const s = await syncItems(store, parsed.matched, {
        rowSource: 'learn_ics',
        changeSource: 'learn_ics',
        ownedFlags: [],
        trackMissing: { now: new Date() },
      });
      const unmatched = await proposeUnmatched(store, parsed.unmatched, 'learn_ics');
      await updateLearnFeedMeta(
        admin,
        job.user_id,
        { ...feed.meta, etag: res.etag, last_modified: res.lastModified, last_ok_at: new Date().toISOString() },
        'ok',
      );
      return { ...stats(s), unmatched, outsideTerm: parsed.skipped };
    } catch (e) {
      await updateLearnFeedMeta(admin, job.user_id, feed.meta, 'error');
      throw e;
    }
  });
}

// ---------------------------------------------------------------------------
// UW Open Data: important dates and final exams
// ---------------------------------------------------------------------------

function sectionsOf(meetings: unknown): string[] {
  if (!Array.isArray(meetings)) return [];
  return meetings
    .filter((m): m is { component: string; section: string } => typeof m?.section === 'string')
    .filter((m) => m.component === 'LEC')
    .map((m) => m.section.padStart(3, '0'));
}

export async function syncOpenDataJob(admin: Admin, job: Job): Promise<void> {
  const apiKey = serverEnv.UW_OPENDATA_API_KEY;
  await withSyncRun(admin, job.user_id, 'open_data', async () => {
    if (!apiKey) return { skipped: 'no UW_OPENDATA_API_KEY' };
    const term = await currentTerm(admin, job.user_id);
    const ua = userAgent();
    const store = supabaseItemStore(admin, job.user_id);

    // Term dates are read for the record only: the seed's dates are authoritative (docs/DECISIONS.md).
    const official = mapTerm(await fetchOpenData(`/v3/Terms/${term.code}`, apiKey, ua));

    const datesJson = await fetchOpenData('/v3/ImportantDates', apiKey, ua);
    const dates = mapImportantDates(importantDateSchema.array().parse(datesJson ?? []), term.name);
    const dateStats = await syncItems(store, dates, { rowSource: 'open_data', changeSource: 'open_data', ownedFlags: [] });

    // Empty before the schedule is published (Oct 2 for Fall 2026). That is a success.
    const examsJson = await fetchOpenData(`/v3/ExamSchedules/${term.code}`, apiKey, ua);
    const rows = examRowSchema.array().parse(examsJson ?? []);
    const courses = (await termCourses(admin, term.id)).map((c) => ({
      id: c.id,
      code: c.code,
      slug: c.slug,
      sections: sectionsOf(c.meetings),
    }));
    const finals = mapExamRows(rows, courses);
    const finalStats = finals.length
      ? await syncItems(store, finals, { rowSource: 'open_data', changeSource: 'open_data', ownedFlags: [] })
      : emptyStats();
    const replaced = await dismissPlaceholderFinals(admin, job.user_id, finals.map((f) => f.courseId).filter((id): id is string => Boolean(id)));

    return { officialTerm: official, dates: stats(dateStats), finals: stats(finalStats), examRows: rows.length, replaced };
  });
}

/** One final per course: the schedule page's and the outline's placeholders step aside for the official one. */
async function dismissPlaceholderFinals(admin: Admin, userId: string, courseIds: string[]): Promise<number> {
  if (!courseIds.length) return 0;
  const { data, error } = await admin
    .from('items')
    .update({ state: 'dismissed', last_change_source: 'open_data' })
    .eq('user_id', userId)
    .eq('kind', 'final')
    .eq('state', 'active')
    .in('source', ['cs251_schedule', 'seed'])
    .in('course_id', courseIds)
    .select('id');
  if (error) throw new Error(`Could not replace placeholder finals: ${error.message}`);
  return data?.length ?? 0;
}

export const SYNC_HANDLERS = {
  [JOB_SYNC_PAGE]: syncPageJob,
  [JOB_SYNC_LEARN]: syncLearnJob,
  [JOB_SYNC_OPEN_DATA]: syncOpenDataJob,
};
