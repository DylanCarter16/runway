'use server';

import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/db/server';
import { enqueueNoteWork } from '@/lib/jobs/notes';
import { runQueuedJobs } from '@/lib/jobs/schedule';
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

export type NewNoteOutcome = { status: 'saved'; id: string; cleaning: boolean } | { status: 'duplicate'; id: string; title: string };

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
 * Stores a note exactly as pasted. Used by /notes/new and by the Inbox for
 * "Lecture notes" pastes. The same text pasted again returns the saved note.
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

  const { data: course } = await supabase.from('courses').select('id, ai_allowed').eq('id', courseId).maybeSingle();
  if (!course) return { ok: false, error: 'That course no longer exists.' };

  const { data: note, error } = await supabase
    .from('notes')
    .insert({
      user_id: user.id,
      course_id: courseId,
      lecture_on: lectureOn,
      title: title || null,
      original_md: text,
      content_hash: hash,
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
    const { admin } = await enqueueNoteWork(user.id, note.id, { cleanup: course.ai_allowed, refreshReminders: true });
    startWorker(admin);
  } catch (e) {
    console.error('note follow-up failed:', e instanceof Error ? e.message : e);
  }
  revalidatePath('/', 'layout');
  return { ok: true, data: { status: 'saved', id: note.id, cleaning: course.ai_allowed } };
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
