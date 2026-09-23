'use server';

import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import { DOC_KINDS } from '@/lib/ai/schemas';
import { createClient, requireUser } from '@/lib/db/server';
import type { Json } from '@/lib/db/types';
import { ApprovalError, approvalEditSchema, planApproval, type ApprovalEdit, type ApprovalWrites } from '@/lib/inbox/apply';
import { enqueueExtract } from '@/lib/jobs/inbox';
import { rebuildDocumentChunks } from '@/lib/notes/store';
import { createNote } from '../notes/actions';
import { runQueuedJobs } from '@/lib/jobs/schedule';
import { addDaysToDate, fromTorontoLocal, toTorontoDate } from '@/lib/time';
import type { ActionResult } from '../actions';

// Paste box and review queue (SPEC 4.4).

const pasteSchema = z.object({
  text: z.string().max(200_000, 'That paste is over 200,000 characters. Split it into parts.').refine((t) => t.trim().length > 0, 'Paste something first.'),
  courseId: z.uuid().nullable(),
  kind: z.enum(['detect', ...DOC_KINDS]),
});

export type PasteInput = z.infer<typeof pasteSchema>;

export type PasteOutcome =
  | { status: 'duplicate'; href: string; label: string }
  | { status: 'note'; href: string }
  | { status: 'saved'; documentId: string; href: string; extracting: boolean };

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function titleFor(text: string, kind: string): string {
  const first = text
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean);
  const label = kind === 'detect' ? 'Paste' : kind.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  if (!first) return label;
  return first.length > 80 ? `${first.slice(0, 77)}...` : first;
}

function startWorker(admin: Awaited<ReturnType<typeof enqueueExtract>>) {
  after(async () => {
    try {
      await runQueuedJobs(admin);
    } catch (e) {
      console.error('job worker failed:', e instanceof Error ? e.message : e);
    }
  });
}

export async function pasteText(input: PasteInput): Promise<ActionResult<PasteOutcome>> {
  const parsed = pasteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the paste.' };
  const user = await requireUser();
  const supabase = await createClient();
  const { text, courseId, kind } = parsed.data;
  const hash = sha256(text);

  // "Already saved" covers documents of any kind and notes.
  const [{ data: doc }, { data: note }] = await Promise.all([
    supabase.from('documents').select('id, title').eq('content_hash', hash).limit(1).maybeSingle(),
    supabase.from('notes').select('id, title').eq('content_hash', hash).limit(1).maybeSingle(),
  ]);
  if (doc) return { ok: true, data: { status: 'duplicate', href: `/library/${doc.id}`, label: doc.title } };
  if (note) return { ok: true, data: { status: 'duplicate', href: `/notes/${note.id}`, label: note.title ?? 'a lecture note' } };

  let courseAi = false;
  if (courseId) {
    const { data: course } = await supabase.from('courses').select('id, ai_allowed').eq('id', courseId).maybeSingle();
    if (!course) return { ok: false, error: 'That course no longer exists.' };
    courseAi = course.ai_allowed;
  }

  if (kind === 'lecture_notes') {
    if (!courseId) return { ok: false, error: 'Pick a course for lecture notes.' };
    const res = await createNote({ courseId, lectureOn: toTorontoDate(new Date()), text });
    if (!res.ok) return res;
    return { ok: true, data: { status: 'note', href: `/notes/${res.data.id}` } };
  }

  const { data: saved, error } = await supabase
    .from('documents')
    .insert({
      user_id: user.id,
      course_id: courseId,
      kind: kind === 'detect' ? 'other' : kind,
      title: titleFor(text, kind),
      raw_text: text,
      content_hash: hash,
      meta: { declared_kind: kind, via: 'inbox' } as Json,
    })
    .select('id')
    .single();
  if (error) return { ok: false, error: `Could not save the paste: ${error.message}` };
  await rebuildDocumentChunks(supabase, {
    id: saved.id,
    user_id: user.id,
    course_id: courseId,
    kind: 'other',
    raw_text: text,
    source_ref: null,
  }).catch((e) => console.error(e));

  try {
    startWorker(await enqueueExtract(user.id, saved.id));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Saved, but extraction could not start.' };
  }
  revalidatePath('/', 'layout');
  // Tables Runway reads itself (Quest, Odyssey) are extracted for every course.
  const ruleBased = kind === 'quest_schedule' || kind === 'odyssey_paste' || kind === 'detect';
  return { ok: true, data: { status: 'saved', documentId: saved.id, href: `/library/${saved.id}`, extracting: courseAi || ruleBased } };
}

export interface PasteStatus {
  done: boolean;
  status: string | null;
  proposals: number;
  notes: string[];
  suggestNote: boolean;
}

export async function getPasteStatus(documentId: string): Promise<ActionResult<PasteStatus>> {
  if (!z.uuid().safeParse(documentId).success) return { ok: false, error: 'Unknown document.' };
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.from('documents').select('processed_at, meta').eq('id', documentId).maybeSingle();
  if (!data) return { ok: false, error: 'Unknown document.' };
  const meta = (data.meta ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    data: {
      done: Boolean(data.processed_at),
      status: (meta.status as string) ?? null,
      proposals: Number(meta.proposals ?? 0),
      notes: (meta.notes as string[]) ?? [],
      suggestNote: meta.status === 'suggest_note',
    },
  };
}

/** "This looks like lecture notes. Save it as a note?" The document stays in the Library too. */
export async function saveDocumentAsNote(documentId: string): Promise<ActionResult<{ href: string }>> {
  if (!z.uuid().safeParse(documentId).success) return { ok: false, error: 'Unknown document.' };
  await requireUser();
  const supabase = await createClient();
  const { data: doc } = await supabase.from('documents').select('course_id, raw_text, captured_at').eq('id', documentId).maybeSingle();
  if (!doc) return { ok: false, error: 'Unknown document.' };
  if (!doc.course_id) return { ok: false, error: 'Pick a course for lecture notes.' };
  const res = await createNote({ courseId: doc.course_id, lectureOn: toTorontoDate(new Date(doc.captured_at)), text: doc.raw_text });
  if (!res.ok) return res;
  revalidatePath('/', 'layout');
  return { ok: true, data: { href: `/notes/${res.data.id}` } };
}

async function applyWrites(supabase: Awaited<ReturnType<typeof createClient>>, writes: ApprovalWrites): Promise<string | null> {
  let itemId: string | null = null;
  if (writes.insertItem) {
    const { data, error } = await supabase.from('items').insert(writes.insertItem).select('id').single();
    if (error) {
      if (error.code === '23505') throw new ApprovalError('This item was already added.');
      throw new ApprovalError(`Could not add the item: ${error.message}`);
    }
    itemId = data.id;
  }
  if (writes.updateItem) {
    const { error } = await supabase.from('items').update(writes.updateItem.patch).eq('id', writes.updateItem.id);
    if (error) throw new ApprovalError(`Could not update the item: ${error.message}`);
    itemId = writes.updateItem.id;
  }
  if (writes.updateCourse) {
    const { error } = await supabase.from('courses').update(writes.updateCourse.patch).eq('id', writes.updateCourse.id);
    if (error) throw new ApprovalError(`Could not update the course: ${error.message}`);
  }
  if (writes.insertGrade) {
    const { error } = await supabase.from('grades').insert(writes.insertGrade);
    if (error) throw new ApprovalError(`Could not save the grade: ${error.message}`);
  }
  return itemId;
}

async function approveOne(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  id: string,
  edit?: ApprovalEdit,
): Promise<void> {
  const { data: p } = await supabase.from('proposals').select('*').eq('id', id).maybeSingle();
  if (!p) throw new ApprovalError('That proposal no longer exists.');
  if (p.state !== 'pending') throw new ApprovalError('That proposal was already decided.');
  const [{ data: target }, { data: course }] = await Promise.all([
    p.target_item_id
      ? supabase
          .from('items')
          .select('id, course_id, kind, title, due_at, starts_at, ends_at, all_day, time_known, location, seat, weight_percent, locked_fields')
          .eq('id', p.target_item_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    p.course_id ? supabase.from('courses').select('id, info_notes').eq('id', p.course_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const writes = planApproval(
    p,
    {
      userId,
      target: target ? { ...target, weight_percent: target.weight_percent === null ? null : Number(target.weight_percent) } : null,
      course,
    },
    edit,
  );
  const itemId = await applyWrites(supabase, writes);
  const { error } = await supabase
    .from('proposals')
    .update({ state: 'approved', decided_at: new Date().toISOString(), applied_item_id: itemId })
    .eq('id', id);
  if (error) throw new ApprovalError(`Saved, but the proposal could not be marked approved: ${error.message}`);
}

function failure(e: unknown): ActionResult<never> {
  if (e instanceof ApprovalError) return { ok: false, error: e.message };
  return { ok: false, error: e instanceof Error ? e.message : 'Approving failed.' };
}

export async function approveProposal(id: string, edit?: ApprovalEdit): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: 'Unknown proposal.' };
  const parsedEdit = edit === undefined ? undefined : approvalEditSchema.safeParse(edit);
  if (parsedEdit && !parsedEdit.success) return { ok: false, error: parsedEdit.error.issues[0]?.message ?? 'Check the form.' };
  const user = await requireUser();
  const supabase = await createClient();
  try {
    await approveOne(supabase, user.id, id, parsedEdit?.data);
  } catch (e) {
    return failure(e);
  }
  revalidatePath('/', 'layout');
  return { ok: true, data: null };
}

export async function dismissProposal(id: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: 'Unknown proposal.' };
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from('proposals')
    .update({ state: 'dismissed', decided_at: new Date().toISOString() })
    .eq('id', id)
    .eq('state', 'pending');
  if (error) return { ok: false, error: `Could not dismiss: ${error.message}` };
  revalidatePath('/', 'layout');
  return { ok: true, data: null };
}

/** Bulk approve for one source document (behind a confirm dialog in the UI). */
export async function approveAllForDocument(documentId: string): Promise<ActionResult<{ approved: number; failed: string[] }>> {
  if (!z.uuid().safeParse(documentId).success) return { ok: false, error: 'Unknown document.' };
  const user = await requireUser();
  const supabase = await createClient();
  const { data: pending, error } = await supabase
    .from('proposals')
    .select('id')
    .eq('source_document_id', documentId)
    .eq('state', 'pending')
    .order('created_at');
  if (error) return { ok: false, error: `Could not read proposals: ${error.message}` };
  let approved = 0;
  const failed: string[] = [];
  for (const p of pending ?? []) {
    try {
      await approveOne(supabase, user.id, p.id);
      approved++;
    } catch (e) {
      failed.push(e instanceof Error ? e.message : 'Approving failed.');
    }
  }
  revalidatePath('/', 'layout');
  return { ok: true, data: { approved, failed } };
}

const reminderActionSchema = z.object({ id: z.uuid(), action: z.enum(['done', 'snooze']) });

/** Done closes a paste reminder for good; snooze hides it until 9:00 tomorrow. */
export async function updateReminder(input: z.infer<typeof reminderActionSchema>): Promise<ActionResult> {
  await requireUser();
  const parsed = reminderActionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Unknown reminder.' };
  const supabase = await createClient();
  const patch =
    parsed.data.action === 'done'
      ? { done_at: new Date().toISOString() }
      : { snoozed_until: fromTorontoLocal(addDaysToDate(toTorontoDate(new Date()), 1), '09:00').toISOString() };
  const { error } = await supabase.from('reminders').update(patch).eq('id', parsed.data.id);
  if (error) return { ok: false, error: `Could not update the reminder: ${error.message}` };
  revalidatePath('/', 'layout');
  return { ok: true, data: null };
}
