'use server';

import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/db/server';
import type { Json } from '@/lib/db/types';
import { keepWholeFileNote } from '@/lib/jobs/files';
import { enqueueNoteWork } from '@/lib/jobs/notes';
import { runQueuedJobs } from '@/lib/jobs/schedule';
import { describePlan, planIncremental, type IncrementalPlan } from '@/lib/notes/incremental';
import { rebuildNoteChunks } from '@/lib/notes/store';
import type { ActionResult } from '../actions';

// Notes (SPEC 4.5): save the original as pasted, queue cleanup for AI-on
// courses, and edit, reset, or re-run the cleaned copy. original_md is never
// written after insert (a DB trigger rejects it too).

const MAX_NOTE = 200_000;

const newNoteSchema = z.object({
  courseId: z.uuid('Pick a course.'),
  lectureOn: z.iso.date('Pick the lecture date.'),
  title: z.string().trim().max(200).optional(),
  text: z
    .string()
    .max(MAX_NOTE, 'That note is over 200,000 characters. Split it into parts.')
    .refine((t) => t.trim().length > 0, 'Paste your notes first.'),
});

export type NewNoteInput = z.infer<typeof newNoteSchema>;

export type NewNoteOutcome =
  | { status: 'saved'; id: string; cleaning: boolean; decision: string | null }
  | { status: 'duplicate'; id: string; title: string }
  /** The paste holds nothing that isn't stored already; the full paste is kept as a document. */
  | { status: 'nothing_new'; documentId: string; decision: string };

/** What notes.incremental holds for a note cut from a running-notes paste. */
export interface IncrementalRecord {
  kind: 'text' | 'file';
  mode: 'new' | 'whole';
  document_id?: string;
  counts?: IncrementalPlan['counts'];
  summary?: string;
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function startWorker(admin: Awaited<ReturnType<typeof enqueueNoteWork>>['admin']) {
  after(async () => {
    try {
      await runQueuedJobs(admin);
    } catch (e) {
      console.error('job worker failed:', e instanceof Error ? e.message : e);
    }
  });
}

const idSchema = z.uuid();

async function loadNote(supabase: Supabase, id: string) {
  const { data } = await supabase
    .from('notes')
    .select('id, user_id, course_id, original_md, cleaned_md, edited_md, cleanup_status, courses(ai_allowed)')
    .eq('id', id)
    .maybeSingle();
  return data;
}

/**
 * What was pasted for this course before: the latest running-notes paste (to line the new
 * one up against) and every earlier paste and note (so text that moved isn't new).
 */
async function earlierForCourse(supabase: Supabase, courseId: string) {
  const [{ data: sources }, { data: notes }] = await Promise.all([
    supabase.from('documents').select('id, raw_text, captured_at').eq('course_id', courseId).eq('kind', 'note_source').order('captured_at', { ascending: false }),
    supabase.from('notes').select('original_md').eq('course_id', courseId),
  ]);
  const latest = sources?.[0]?.raw_text ?? null;
  const earlier = [...(sources ?? []).slice(1).map((s) => s.raw_text), ...(notes ?? []).map((n) => n.original_md)];
  return { latest, earlier };
}

async function insertNote(
  supabase: Supabase,
  userId: string,
  course: { id: string; ai_allowed: boolean },
  fields: { lectureOn: string | null; title: string | null; text: string; sourceDocumentId: string | null; incremental: IncrementalRecord | null },
): Promise<ActionResult<{ id: string }>> {
  const { data: note, error } = await supabase
    .from('notes')
    .insert({
      user_id: userId,
      course_id: course.id,
      lecture_on: fields.lectureOn,
      title: fields.title,
      original_md: fields.text,
      content_hash: sha256(fields.text),
      source_document_id: fields.sourceDocumentId,
      incremental: fields.incremental as unknown as Json,
    })
    .select('id, user_id, course_id, original_md, cleaned_md, edited_md')
    .single();
  if (error) {
    if (error.code === '23505') return { ok: false, error: 'This note is already saved.' };
    return { ok: false, error: `Could not save the note: ${error.message}` };
  }
  // Searchable and askable right away, from the original; cleanup rebuilds the chunks.
  try {
    await rebuildNoteChunks(supabase, note);
    const { admin } = await enqueueNoteWork(userId, note.id, { cleanup: course.ai_allowed, refreshReminders: true });
    startWorker(admin);
  } catch (e) {
    console.error('note follow-up failed:', e instanceof Error ? e.message : e);
  }
  return { ok: true, data: { id: note.id } };
}

/**
 * Saves lecture notes. Used by /notes/new and by the Inbox for "Lecture notes" pastes.
 * Dylan keeps one running document per course and pastes all of it (PHASES.md Phase 9,
 * part B): the full paste is stored as a note_source document, and the note holds only
 * what is new since the last paste, with edited paragraphs marked as revisions. The first
 * paste for a course becomes the note whole. The same text pasted again returns the saved note.
 */
export async function createNote(input: NewNoteInput): Promise<ActionResult<NewNoteOutcome>> {
  const parsed = newNoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the note.' };
  const user = await requireUser();
  const supabase = await createClient();
  const { courseId, lectureOn, title, text } = parsed.data;
  const hash = sha256(text);

  const { data: existing } = await supabase.from('notes').select('id, title').eq('content_hash', hash).maybeSingle();
  if (existing) return { ok: true, data: { status: 'duplicate', id: existing.id, title: existing.title ?? 'a lecture note' } };

  const { data: course } = await supabase.from('courses').select('id, code, ai_allowed').eq('id', courseId).maybeSingle();
  if (!course) return { ok: false, error: 'That course no longer exists.' };

  const { latest, earlier } = await earlierForCourse(supabase, courseId);
  const plan = planIncremental(latest, text, earlier);
  const decision = describePlan(plan);

  // Keep everything: the whole paste is stored as it came, whatever the note ends up holding.
  const { data: stored } = await supabase.from('documents').select('id').eq('kind', 'note_source').eq('content_hash', hash).maybeSingle();
  let sourceId = stored?.id ?? null;
  if (!sourceId) {
    const { data: doc, error: docErr } = await supabase
      .from('documents')
      .insert({
        user_id: user.id,
        course_id: courseId,
        kind: 'note_source',
        title: `${course.code} running notes, pasted for ${lectureOn}`,
        raw_text: text,
        content_hash: hash,
        processed_at: new Date().toISOString(),
        meta: { via: 'notes', lecture_on: lectureOn, decision } as Json,
      })
      .select('id')
      .single();
    if (docErr) return { ok: false, error: `Could not store the paste: ${docErr.message}` };
    sourceId = doc.id;
  }

  if (plan.nothingNew) {
    revalidatePath('/', 'layout');
    return { ok: true, data: { status: 'nothing_new', documentId: sourceId, decision } };
  }

  const incremental: IncrementalRecord = plan.hadPrevious
    ? { kind: 'text', mode: 'new', document_id: sourceId, counts: plan.counts, summary: decision }
    : { kind: 'text', mode: 'whole', document_id: sourceId, summary: decision };
  const saved = await insertNote(supabase, user.id, course, {
    lectureOn,
    title: title || null,
    text: plan.hadPrevious ? plan.markdown : text,
    sourceDocumentId: sourceId,
    incremental,
  });
  if (!saved.ok) return saved;
  revalidatePath('/', 'layout');
  return { ok: true, data: { status: 'saved', id: saved.data.id, cleaning: course.ai_allowed, decision: plan.hadPrevious ? decision : null } };
}

const keepWholeSchema = z.object({ noteId: z.uuid().optional(), documentId: z.uuid().optional() });

/**
 * Undo for a note cut from a paste: makes one note from the whole paste (or, for a file,
 * from every page) and removes the cut note. Works from a note, or from a paste that had
 * nothing new and so has no note.
 */
export async function keepWholePaste(input: { noteId?: string; documentId?: string }): Promise<ActionResult<{ id: string }>> {
  const parsed = keepWholeSchema.safeParse(input);
  if (!parsed.success || (!parsed.data.noteId && !parsed.data.documentId)) return { ok: false, error: 'Unknown note.' };
  const user = await requireUser();
  const supabase = await createClient();

  let cut: { id: string; lecture_on: string | null; title: string | null; source_document_id: string | null; incremental: Json | null } | null = null;
  if (parsed.data.noteId) {
    const { data } = await supabase.from('notes').select('id, lecture_on, title, source_document_id, incremental').eq('id', parsed.data.noteId).maybeSingle();
    if (!data) return { ok: false, error: 'Unknown note.' };
    cut = data;
  }
  const documentId = parsed.data.documentId ?? cut?.source_document_id;
  if (!documentId) return { ok: false, error: 'This note was not cut from a paste.' };
  const { data: doc } = await supabase.from('documents').select('id, kind, course_id, raw_text, meta, courses(id, ai_allowed)').eq('id', documentId).maybeSingle();
  if (!doc?.courses) return { ok: false, error: 'The stored paste is gone.' };

  let newId: string;
  if (doc.kind === 'note_source') {
    const meta = (doc.meta ?? {}) as { lecture_on?: string };
    const saved = await insertNote(supabase, user.id, doc.courses, {
      lectureOn: cut?.lecture_on ?? meta.lecture_on ?? null,
      title: cut?.title ?? null,
      text: doc.raw_text,
      sourceDocumentId: doc.id,
      incremental: { kind: 'text', mode: 'whole', document_id: doc.id },
    });
    if (!saved.ok) return saved;
    newId = saved.data.id;
  } else {
    const made = await keepWholeFileNote(user.id, doc.id);
    if (!made) return { ok: false, error: 'Could not make a note from the whole file.' };
    newId = made;
  }

  if (cut) {
    const { error } = await supabase.from('notes').delete().eq('id', cut.id);
    if (error) return { ok: false, error: `Made the whole note, but could not remove the cut one: ${error.message}` };
  }
  revalidatePath('/', 'layout');
  return { ok: true, data: { id: newId } };
}

export interface NoteStatus {
  status: string;
  error: string | null;
}

export async function getNoteStatus(id: string): Promise<ActionResult<NoteStatus>> {
  if (!idSchema.safeParse(id).success) return { ok: false, error: 'Unknown note.' };
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.from('notes').select('cleanup_status, cleanup_error').eq('id', id).maybeSingle();
  if (!data) return { ok: false, error: 'Unknown note.' };
  return { ok: true, data: { status: data.cleanup_status, error: data.cleanup_error } };
}

const editSchema = z.object({ id: z.uuid(), markdown: z.string().max(MAX_NOTE, 'That is over 200,000 characters.') });

/** Saves Dylan's version of the cleaned copy; Claude's copy stays in cleaned_md. */
export async function saveNoteEdit(input: { id: string; markdown: string }): Promise<ActionResult> {
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the edit.' };
  await requireUser();
  const supabase = await createClient();
  const note = await loadNote(supabase, parsed.data.id);
  if (!note) return { ok: false, error: 'Unknown note.' };
  if (!note.courses?.ai_allowed) return { ok: false, error: 'This course has AI off, so its note has only your original.' };
  const edited = parsed.data.markdown.trim() ? parsed.data.markdown : null;
  const { error } = await supabase.from('notes').update({ edited_md: edited }).eq('id', note.id);
  if (error) return { ok: false, error: `Could not save the edit: ${error.message}` };
  await rebuildNoteChunks(supabase, { ...note, edited_md: edited }).catch((e) => console.error(e));
  revalidatePath(`/notes/${note.id}`);
  return { ok: true, data: null };
}

/** "Reset to Claude's copy": clears the edit. */
export async function resetNoteEdit(id: string): Promise<ActionResult> {
  if (!idSchema.safeParse(id).success) return { ok: false, error: 'Unknown note.' };
  await requireUser();
  const supabase = await createClient();
  const note = await loadNote(supabase, id);
  if (!note) return { ok: false, error: 'Unknown note.' };
  const { error } = await supabase.from('notes').update({ edited_md: null }).eq('id', id);
  if (error) return { ok: false, error: `Could not reset: ${error.message}` };
  await rebuildNoteChunks(supabase, { ...note, edited_md: null }).catch((e) => console.error(e));
  revalidatePath(`/notes/${id}`);
  return { ok: true, data: null };
}

const rerunSchema = z.object({
  id: z.uuid(),
  instruction: z.string().trim().max(500, 'Keep the instruction under 500 characters.').optional(),
  replaceEdit: z.boolean().optional(),
});

/** Cleans the note again, with an optional instruction. Also starts a first cleanup that never ran. */
export async function rerunCleanup(input: { id: string; instruction?: string; replaceEdit?: boolean }): Promise<ActionResult> {
  const parsed = rerunSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the instruction.' };
  const user = await requireUser();
  const supabase = await createClient();
  const note = await loadNote(supabase, parsed.data.id);
  if (!note) return { ok: false, error: 'Unknown note.' };
  if (!note.courses?.ai_allowed) return { ok: false, error: 'This course has AI off, so its notes are not sent to Claude.' };
  if (note.cleanup_status === 'running') return { ok: false, error: 'Cleanup is already running.' };
  if (note.edited_md && !parsed.data.replaceEdit) return { ok: false, error: 'Confirm that the new copy replaces your edited version.' };

  const { error } = await supabase
    .from('notes')
    .update({ cleanup_instruction: parsed.data.instruction || null, cleanup_status: 'pending', cleanup_error: null })
    .eq('id', note.id);
  if (error) return { ok: false, error: `Could not start cleanup: ${error.message}` };
  const { admin, queued } = await enqueueNoteWork(user.id, note.id, { cleanup: true, replaceEdit: Boolean(note.edited_md) });
  if (!queued) return { ok: false, error: 'Cleanup is already queued.' };
  startWorker(admin);
  revalidatePath(`/notes/${note.id}`);
  return { ok: true, data: null };
}
