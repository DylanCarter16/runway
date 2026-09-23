import 'server-only';
import { callClaudeText } from '@/lib/ai/client';
import { AiNotAllowedError } from '@/lib/ai/switch';
import { createAdminClient } from '@/lib/db/admin';
import { cleanPart, finishCleanup, planCleanup, type CleanupNote } from '@/lib/notes/cleanup';
import { noteMetadata } from '@/lib/notes/meta';
import { rebuildNoteChunks } from '@/lib/notes/store';
import { toTorontoDate } from '@/lib/time';
import { JOB_REMINDERS } from './gcal';
import { aiConfigured, liveAiDeps, liveClaude, monthSpendUsd, overBudget } from './ai';
import { insertProposals, loadPlannerContext } from './inbox';
import { enqueue, type Admin, type Job, type JobHandler } from './queue';

// Notes jobs (Phase 5 tasks 2, 3, 6). Cleanup runs the note's parts in order:
// several in one step while they are quick, otherwise one step per part, each
// step queueing the next with the parts done so far. When the last part is in,
// it saves cleaned_md, rebuilds the chunks, and queues the metadata job.
// Notes whose course has AI off are never queued; the handlers check again.

export const JOB_NOTE_CLEANUP = 'notes.cleanup';
export const JOB_NOTE_META = 'notes.meta';

/** Start a new part in the same step only this early, so a step stays under 60 s. */
const MORE_PARTS_BEFORE_MS = 12_000;

interface CleanupPayload {
  noteId: string;
  /** Cleaned parts so far, in order. */
  done?: string[];
  model?: string;
  /** Re-run confirmed over an edited copy: drop the edit when the new copy lands. */
  replaceEdit?: boolean;
}

export function cleanupJob(userId: string, noteId: string, opts: { replaceEdit?: boolean } = {}) {
  return {
    userId,
    type: JOB_NOTE_CLEANUP,
    payload: { noteId, done: [], replaceEdit: Boolean(opts.replaceEdit) },
    dedupeKey: `notes:cleanup:${noteId}`,
    maxAttempts: 2,
  };
}

/**
 * Queues the work a new or changed note needs: cleanup when its course has AI on
 * (false when one is already queued or running), and a reminders refresh so the
 * day's lecture-note reminder closes. Returns the admin client for after().
 */
export async function enqueueNoteWork(
  userId: string,
  noteId: string,
  opts: { cleanup: boolean; replaceEdit?: boolean; refreshReminders?: boolean },
): Promise<{ admin: Admin; queued: boolean }> {
  const admin = createAdminClient();
  let queued = false;
  if (opts.cleanup) queued = await enqueue(admin, cleanupJob(userId, noteId, { replaceEdit: opts.replaceEdit }));
  if (opts.refreshReminders) await enqueue(admin, { userId, type: JOB_REMINDERS, dedupeKey: 'reminders:generate' });
  return { admin, queued };
}

function metaJob(userId: string, noteId: string, warnings: string[]) {
  return { userId, type: JOB_NOTE_META, payload: { noteId, warnings }, dedupeKey: `notes:meta:${noteId}` };
}

async function readNote(admin: Admin, job: Job, noteId: string) {
  const { data, error } = await admin
    .from('notes')
    .select('id, user_id, course_id, lecture_on, title, original_md, cleaned_md, edited_md, cleanup_instruction')
    .eq('id', noteId)
    .eq('user_id', job.user_id)
    .maybeSingle();
  if (error) throw new Error(`Could not read the note: ${error.message}`);
  return data;
}

async function aiBlocked(admin: Admin, userId: string): Promise<string | null> {
  if (!aiConfigured()) return 'Claude is not set up yet (no API key), so this note has no cleaned copy.';
  if (overBudget(await monthSpendUsd(admin, userId))) return "This month's AI budget is spent, so this note has no cleaned copy.";
  return null;
}

const cleanupHandler: JobHandler = async (admin, job) => {
  const payload = job.payload as unknown as CleanupPayload;
  if (!payload?.noteId) throw new Error('Job has no noteId.');
  const note = await readNote(admin, job, payload.noteId);
  if (!note) return;

  const { data: courses, error: cErr } = await admin.from('courses').select('id, code, title, ai_allowed').eq('user_id', job.user_id);
  if (cErr) throw new Error(`Could not read courses: ${cErr.message}`);
  const input: CleanupNote = { id: note.id, course_id: note.course_id, lecture_on: note.lecture_on, original_md: note.original_md };

  let plan;
  try {
    plan = await planCleanup(input, courses ?? []);
  } catch (e) {
    if (e instanceof AiNotAllowedError) return;
    throw e;
  }

  const blocked = await aiBlocked(admin, job.user_id);
  if (blocked) {
    await admin.from('notes').update({ cleanup_status: 'failed', cleanup_error: blocked }).eq('id', note.id);
    await rebuildNoteChunks(admin, note);
    return;
  }

  const { data: settings } = await admin.from('settings').select('note_style_prompt').eq('user_id', job.user_id).maybeSingle();
  const deps = liveAiDeps(admin);
  const done = [...(payload.done ?? [])];
  let model = payload.model ?? '';
  const started = Date.now();

  await admin.from('notes').update({ cleanup_status: 'running', cleanup_error: null }).eq('id', note.id);
  try {
    while (done.length < plan.parts.length) {
      if (done.length > (payload.done?.length ?? 0) && Date.now() - started > MORE_PARTS_BEFORE_MS) break;
      const r = await cleanPart(
        {
          userId: job.user_id,
          note: input,
          plan,
          index: done.length,
          instruction: note.cleanup_instruction,
          style: settings?.note_style_prompt ?? null,
        },
        (req) => callClaudeText(deps, req),
      );
      done.push(r.text);
      model = r.model;
    }
  } catch (e) {
    if (job.attempts >= job.max_attempts) {
      const message = e instanceof Error ? e.message : String(e);
      await admin.from('notes').update({ cleanup_status: 'failed', cleanup_error: message.slice(0, 500) }).eq('id', note.id);
      await rebuildNoteChunks(admin, note);
      // Metadata still runs, on the original.
      await enqueue(admin, metaJob(job.user_id, note.id, []));
      return;
    }
    throw e;
  }

  if (done.length < plan.parts.length) {
    await enqueue(admin, {
      userId: job.user_id,
      type: JOB_NOTE_CLEANUP,
      payload: { ...payload, done, model },
      dedupeKey: `notes:cleanup:${note.id}:${done.length}`,
      maxAttempts: 2,
    });
    return;
  }

  const { cleaned, warnings } = finishCleanup(note.original_md, done);
  const patch = {
    cleaned_md: cleaned,
    cleanup_model: model,
    cleaned_at: new Date().toISOString(),
    cleanup_status: 'done',
    cleanup_error: null,
    open_questions: warnings,
    ...(payload.replaceEdit ? { edited_md: null } : {}),
  };
  const { error } = await admin.from('notes').update(patch).eq('id', note.id);
  if (error) throw new Error(`Could not save the cleaned copy: ${error.message}`);
  await rebuildNoteChunks(admin, { ...note, ...patch, edited_md: payload.replaceEdit ? null : note.edited_md });
  await enqueue(admin, metaJob(job.user_id, note.id, warnings));
};

const metaHandler: JobHandler = async (admin, job) => {
  const { noteId, warnings = [] } = job.payload as { noteId?: string; warnings?: string[] };
  if (!noteId) throw new Error('Job has no noteId.');
  const note = await readNote(admin, job, noteId);
  if (!note) return;
  const ctx = await loadPlannerContext(admin, job.user_id);
  if (!ctx.courses.find((c) => c.id === note.course_id)?.ai_allowed) return;
  if (await aiBlocked(admin, job.user_id)) return;

  const meta = await noteMetadata(
    {
      userId: job.user_id,
      noteId: note.id,
      courseId: note.course_id,
      lectureOn: note.lecture_on,
      text: note.cleaned_md ?? note.original_md,
      courses: ctx.courses,
      items: ctx.items,
      today: toTorontoDate(new Date()),
      term: ctx.term,
    },
    liveClaude(admin),
  );
  const { error } = await admin
    .from('notes')
    .update({
      ...(note.title ? {} : { title: meta.title }),
      topics: meta.topics,
      summary: meta.summary,
      open_questions: [...warnings, ...meta.openQuestions],
    })
    .eq('id', note.id);
  if (error) throw new Error(`Could not save the note's metadata: ${error.message}`);
  // A re-run replaces the note's pending proposals; decided ones stay.
  await admin.from('proposals').delete().eq('source_note_id', note.id).eq('state', 'pending');
  await insertProposals(admin, job.user_id, { noteId: note.id }, meta.proposals);
};

export const NOTE_HANDLERS: Record<string, JobHandler> = {
  [JOB_NOTE_CLEANUP]: cleanupHandler,
  [JOB_NOTE_META]: metaHandler,
};
