import 'server-only';
import type { ClaudeRequest } from '@/lib/ai/client';
import type { PasteKind } from '@/lib/ai/schemas';
import { createAdminClient } from '@/lib/db/admin';
import type { Json } from '@/lib/db/types';
import { summarizeDiff } from '@/lib/inbox/diff-summary';
import { processDocument, type ProcessResult } from '@/lib/inbox/process';
import type { CourseCtx, ItemCtx, PlannedProposal } from '@/lib/inbox/types';
import { toTorontoDate } from '@/lib/time';
import { aiConfigured, liveClaude, monthSpendUsd, overBudget } from './ai';
import { enqueue, type Admin, type Job, type JobHandler } from './queue';

// The paste pipeline's job: classify and extract one stored document, then
// write its proposals. Enqueued by the Inbox paste action.

export const JOB_EXTRACT = 'inbox.extract';

class AiUnavailable extends Error {}

export function extractJob(userId: string, documentId: string) {
  return { userId, type: JOB_EXTRACT, payload: { documentId }, dedupeKey: `extract:${documentId}` };
}

/** Queues extraction for a stored document and returns the admin client for after(). */
export async function enqueueExtract(userId: string, documentId: string): Promise<Admin> {
  const admin = createAdminClient();
  await enqueue(admin, extractJob(userId, documentId));
  return admin;
}

export async function loadPlannerContext(admin: Admin, userId: string) {
  const { data: term } = await admin
    .from('terms')
    .select('id, code, name, starts_on, ends_on')
    .eq('user_id', userId)
    .order('is_current', { ascending: false })
    .order('starts_on', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: courses, error: cErr } = await admin
    .from('courses')
    .select('id, slug, code, title, ai_allowed, meetings')
    .eq('user_id', userId)
    .eq('archived', false);
  if (cErr) throw new Error(`Could not read courses: ${cErr.message}`);
  const { data: items, error: iErr } = await admin
    .from('items')
    .select('id, course_id, kind, title, due_at, starts_at, ends_at, all_day, time_known, location, seat, weight_percent, state')
    .eq('user_id', userId)
    .eq('state', 'active')
    .limit(1000);
  if (iErr) throw new Error(`Could not read items: ${iErr.message}`);
  return {
    term: term
      ? { code: term.code, name: term.name, startsOn: term.starts_on, endsOn: term.ends_on }
      : { code: 'unknown', name: 'Current term', startsOn: '', endsOn: '' },
    courses: (courses ?? []) as CourseCtx[],
    items: (items ?? []).map((i) => ({ ...i, weight_percent: i.weight_percent === null ? null : Number(i.weight_percent) })) as ItemCtx[],
  };
}

export async function insertProposals(
  admin: Admin,
  userId: string,
  ref: { documentId?: string | null; noteId?: string | null },
  proposals: PlannedProposal[],
) {
  if (!proposals.length) return;
  const { error } = await admin.from('proposals').insert(
    proposals.map((p) => ({
      user_id: userId,
      course_id: p.course_id,
      source_document_id: ref.documentId ?? null,
      source_note_id: ref.noteId ?? null,
      kind: p.kind,
      target_item_id: p.target_item_id,
      payload: p.payload as unknown as Json,
      evidence: p.evidence,
      confidence: p.confidence,
    })),
  );
  if (error) throw new Error(`Could not save proposals: ${error.message}`);
}

const extractHandler: JobHandler = async (admin: Admin, job: Job) => {
  const documentId = (job.payload as { documentId?: string }).documentId;
  if (!documentId) throw new Error('Job has no documentId.');
  const { data: doc, error } = await admin
    .from('documents')
    .select('id, user_id, course_id, kind, raw_text, source_url, meta, processed_at')
    .eq('id', documentId)
    .eq('user_id', job.user_id)
    .maybeSingle();
  if (error) throw new Error(`Could not read the document: ${error.message}`);
  if (!doc || doc.processed_at) return;

  const meta = (doc.meta ?? {}) as Record<string, unknown>;
  const declaredKind = (meta.declared_kind as PasteKind | 'detect' | undefined) ?? (doc.kind as PasteKind);
  const ctx = await loadPlannerContext(admin, job.user_id);

  // Budget and configuration are checked at the moment Claude would be called,
  // so rule-based pastes and AI-off courses never depend on them.
  const claudeLive = liveClaude(admin);
  const claude = async <T>(req: ClaudeRequest<T>) => {
    if (!aiConfigured()) throw new AiUnavailable('Claude is not set up yet (no API key), so this was stored without extraction.');
    if (overBudget(await monthSpendUsd(admin, job.user_id))) {
      throw new AiUnavailable('This month\'s AI budget is spent, so this was stored without extraction.');
    }
    return claudeLive(req);
  };

  let result: ProcessResult;
  try {
    result = await processDocument(
      {
        userId: job.user_id,
        doc: { id: doc.id, course_id: doc.course_id, raw_text: doc.raw_text, source_url: doc.source_url },
        declaredKind,
        courses: ctx.courses,
        items: ctx.items,
        today: toTorontoDate(new Date()),
        term: ctx.term,
      },
      claude,
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const final = e instanceof AiUnavailable || job.attempts >= job.max_attempts;
    if (final) {
      await admin
        .from('documents')
        .update({
          processed_at: new Date().toISOString(),
          meta: { ...meta, status: e instanceof AiUnavailable ? 'stored_only' : 'failed', notes: [message] } as Json,
        })
        .eq('id', doc.id);
    }
    if (e instanceof AiUnavailable) return;
    throw e;
  }

  // A retried job may have written proposals before failing; start clean.
  await admin.from('proposals').delete().eq('source_document_id', doc.id).eq('state', 'pending');
  await insertProposals(admin, job.user_id, { documentId: doc.id }, result.proposals);
  const { error: upErr } = await admin
    .from('documents')
    .update({
      kind: result.kind,
      processed_at: new Date().toISOString(),
      meta: {
        ...meta,
        status: result.status,
        detected_kind: result.detectedKind,
        summary: result.summary,
        importance: result.importance,
        notes: result.notes,
        used_ai: result.usedAi,
        proposals: result.proposals.length,
      } as Json,
    })
    .eq('id', doc.id);
  if (upErr) throw new Error(`Could not update the document: ${upErr.message}`);
};

export const JOB_SUMMARIZE_DIFF = 'inbox.summarize_diff';

export function summarizeDiffJob(userId: string, documentId: string) {
  return { userId, type: JOB_SUMMARIZE_DIFF, payload: { documentId }, dedupeKey: `diff:${documentId}` };
}

/** Claude's summary of a watched page's change, for AI-on courses only. */
const summarizeDiffHandler: JobHandler = async (admin: Admin, job: Job) => {
  const documentId = (job.payload as { documentId?: string }).documentId;
  if (!documentId) throw new Error('Job has no documentId.');
  const { data: doc } = await admin
    .from('documents')
    .select('id, course_id, source_url, meta')
    .eq('id', documentId)
    .eq('user_id', job.user_id)
    .maybeSingle();
  const meta = (doc?.meta ?? {}) as { diff?: { added: string[]; removed: string[] } | null; label?: string; summary?: string };
  if (!doc || !meta.diff || meta.summary) return;
  const ctx = await loadPlannerContext(admin, job.user_id);
  if (!ctx.courses.find((c) => c.id === doc.course_id)?.ai_allowed) return;
  if (!aiConfigured() || overBudget(await monthSpendUsd(admin, job.user_id))) return;

  const result = await summarizeDiff(
    {
      userId: job.user_id,
      documentId: doc.id,
      courseId: doc.course_id,
      label: meta.label ?? 'Course page',
      url: doc.source_url ?? '',
      diff: meta.diff,
      courses: ctx.courses,
      items: ctx.items,
      today: toTorontoDate(new Date()),
      term: ctx.term,
    },
    liveClaude(admin),
  );
  await admin.from('proposals').delete().eq('source_document_id', doc.id).eq('state', 'pending');
  await insertProposals(admin, job.user_id, { documentId: doc.id }, result.proposals);
  const { error } = await admin
    .from('documents')
    .update({ meta: { ...meta, summary: result.summary, importance: result.importance, proposals: result.proposals.length } as Json })
    .eq('id', doc.id);
  if (error) throw new Error(`Could not save the summary: ${error.message}`);
};

export const INBOX_HANDLERS: Record<string, JobHandler> = {
  [JOB_EXTRACT]: extractHandler,
  [JOB_SUMMARIZE_DIFF]: summarizeDiffHandler,
};
