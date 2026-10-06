'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/db/server';
import type { Json } from '@/lib/db/types';
import { LIBRARY_BUCKET, MAX_UPLOAD_BYTES, UPLOAD_TYPES, storagePath } from '@/lib/files/constants';
import type { FileMeta } from '@/lib/files/process';
import { queueFile } from '@/lib/jobs/files';
import { runQueuedJobs } from '@/lib/jobs/schedule';
import type { ActionResult } from '../actions';

// Uploads (PHASES.md Phase 9, part A). The browser sends the file straight to the private
// library bucket under <user_id>/ (a server action body can't carry 50 MB), then calls
// finishUpload, which checks the object is really there and queues the reading job.

const uploadSchema = z.object({
  name: z.string().trim().min(1, 'The file has no name.').max(255),
  size: z.number().int().positive('The file is empty.').max(MAX_UPLOAD_BYTES, "Files over 50 MB can't be stored on the free plan."),
  type: z.enum(UPLOAD_TYPES, 'Only PDFs and images (PNG, JPEG, WebP, GIF, HEIC) can be added.'),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'Bad file hash.'),
  courseId: z.uuid().nullable(),
  purpose: z.enum(['library', 'note', 'textbook']),
  lectureOn: z.iso.date().nullable().optional(),
  noteTitle: z.string().trim().max(200).nullable().optional(),
});

export type UploadInput = z.infer<typeof uploadSchema>;

export type StartUpload =
  | { status: 'upload'; documentId: string; path: string }
  | { status: 'duplicate'; documentId: string; href: string; label: string };

function startWorker(admin: Awaited<ReturnType<typeof queueFile>>) {
  after(async () => {
    try {
      await runQueuedJobs(admin);
    } catch (e) {
      console.error('job worker failed:', e instanceof Error ? e.message : e);
    }
  });
}

/** Checks the file and says where to put it; the same file uploaded before is returned instead. */
export async function startUpload(input: UploadInput): Promise<ActionResult<StartUpload>> {
  const parsed = uploadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the file.' };
  const user = await requireUser();
  const supabase = await createClient();
  const f = parsed.data;
  if ((f.purpose === 'note' || f.purpose === 'textbook') && !f.courseId) return { ok: false, error: 'Pick a course first.' };

  const { data: existing } = await supabase
    .from('documents')
    .select('id, title, meta')
    .in('kind', ['upload', 'textbook'])
    .eq('content_hash', f.sha256)
    .maybeSingle();
  if (existing) {
    const noteId = (existing.meta as FileMeta | null)?.note_id;
    return { ok: true, data: { status: 'duplicate', documentId: existing.id, href: noteId ? `/notes/${noteId}` : `/library/${existing.id}`, label: existing.title } };
  }
  const documentId = crypto.randomUUID();
  return { ok: true, data: { status: 'upload', documentId, path: storagePath(user.id, documentId, f.name) } };
}

const finishSchema = uploadSchema.extend({ documentId: z.uuid(), path: z.string().min(1) });

/** Records an uploaded file and starts reading it. */
export async function finishUpload(input: z.infer<typeof finishSchema>): Promise<ActionResult<{ documentId: string; href: string }>> {
  const parsed = finishSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the file.' };
  const user = await requireUser();
  const supabase = await createClient();
  const f = parsed.data;
  if (f.path !== storagePath(user.id, f.documentId, f.name)) return { ok: false, error: 'That upload is not yours.' };

  // The object must be in this user's folder, at the size the browser said.
  const folder = `${user.id}/${f.documentId}`;
  const { data: listed, error: listErr } = await supabase.storage.from(LIBRARY_BUCKET).list(folder);
  const object = listed?.find((o) => `${folder}/${o.name}` === f.path);
  if (listErr || !object) return { ok: false, error: 'The upload did not arrive. Try again.' };
  const storedSize = Number((object.metadata as { size?: number } | null)?.size ?? f.size);
  if (storedSize !== f.size) return { ok: false, error: 'The upload arrived incomplete. Try again.' };

  const meta: FileMeta = { purpose: f.purpose, status: 'queued', lecture_on: f.lectureOn ?? null, note_title: f.noteTitle || null };
  const { error } = await supabase.from('documents').insert({
    id: f.documentId,
    user_id: user.id,
    course_id: f.courseId,
    kind: f.purpose === 'textbook' ? 'textbook' : 'upload',
    title: f.noteTitle || f.name,
    raw_text: '',
    content_hash: f.sha256,
    storage_path: f.path,
    file_name: f.name,
    file_size: f.size,
    file_type: f.type,
    meta: meta as Json,
  });
  if (error) {
    if (error.code === '23505') return { ok: false, error: 'This file is already stored.' };
    return { ok: false, error: `Could not save the file: ${error.message}` };
  }
  startWorker(await queueFile(user.id, f.documentId));
  revalidatePath('/', 'layout');
  return { ok: true, data: { documentId: f.documentId, href: `/library/${f.documentId}` } };
}

export interface FileStatus {
  done: boolean;
  status: string;
  summary: string | null;
  noteId: string | null;
  nothingNew: boolean;
}

export async function getFileStatus(documentId: string): Promise<ActionResult<FileStatus>> {
  if (!z.uuid().safeParse(documentId).success) return { ok: false, error: 'Unknown file.' };
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.from('documents').select('meta, processed_at').eq('id', documentId).maybeSingle();
  if (!data) return { ok: false, error: 'Unknown file.' };
  const meta = (data.meta ?? {}) as FileMeta;
  return {
    ok: true,
    data: {
      done: meta.status === 'done',
      status: meta.status ?? 'queued',
      summary: meta.summary ?? null,
      noteId: meta.note_id ?? null,
      nothingNew: meta.note_outcome === 'nothing_new',
    },
  };
}

const extractSchema = z
  .object({ documentId: z.uuid(), from: z.number().int().min(1), to: z.number().int().min(1) })
  .refine((v) => v.to >= v.from, 'The last page comes before the first.');

/** Reads a page range of a stored file (a textbook chapter). Pages already read keep their text. */
export async function extractPages(input: { documentId: string; from: number; to: number }): Promise<ActionResult> {
  const parsed = extractSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the pages.' };
  const user = await requireUser();
  const supabase = await createClient();
  const { data: doc } = await supabase.from('documents').select('id, meta').eq('id', parsed.data.documentId).maybeSingle();
  if (!doc) return { ok: false, error: 'Unknown file.' };
  const meta = (doc.meta ?? {}) as FileMeta;
  const count = meta.page_count ?? 0;
  if (count && parsed.data.to > count) return { ok: false, error: `This file has ${count} pages.` };
  const { error } = await supabase
    .from('documents')
    .update({ meta: { ...meta, status: 'queued', extract: { from: parsed.data.from, to: parsed.data.to } } as Json })
    .eq('id', doc.id);
  if (error) return { ok: false, error: `Could not start: ${error.message}` };
  startWorker(await queueFile(user.id, doc.id));
  revalidatePath(`/library/${doc.id}`);
  return { ok: true, data: null };
}

/** Tries pages that failed again (for example after the API key was added). */
export async function retryFailedPages(documentId: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(documentId).success) return { ok: false, error: 'Unknown file.' };
  const user = await requireUser();
  const supabase = await createClient();
  const { data: doc } = await supabase.from('documents').select('id, meta').eq('id', documentId).maybeSingle();
  if (!doc) return { ok: false, error: 'Unknown file.' };
  const { error } = await supabase.from('document_pages').update({ status: 'pending', reason: null }).eq('document_id', doc.id).eq('status', 'failed');
  if (error) return { ok: false, error: `Could not retry: ${error.message}` };
  await supabase.from('documents').update({ meta: { ...((doc.meta ?? {}) as FileMeta), status: 'queued' } as Json }).eq('id', doc.id);
  startWorker(await queueFile(user.id, doc.id));
  revalidatePath(`/library/${doc.id}`);
  return { ok: true, data: null };
}

const pageSearchSchema = z.object({
  q: z.string().trim().min(1, 'Type something to search for.').max(200, 'Search is limited to 200 characters.'),
  documentId: z.uuid().nullable().optional(),
  courseId: z.uuid().nullable().optional(),
});

export interface PageHit {
  documentId: string;
  courseId: string | null;
  title: string;
  page: number;
  heading: string | null;
  /** Page text around the match, with matches between <mark> and </mark>. Render as text. */
  snippet: string;
}

/** Page-level search inside one file, one course's files, or every file (Phase 10). No AI. */
export async function searchPages(input: z.input<typeof pageSearchSchema>): Promise<ActionResult<PageHit[]>> {
  const parsed = pageSearchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the search.' };
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('search_pages', {
    q: parsed.data.q,
    p_document_id: parsed.data.documentId ?? undefined,
    p_course_id: parsed.data.courseId ?? undefined,
    p_limit: 50,
  });
  if (error) return { ok: false, error: `Search failed: ${error.message}` };
  return {
    ok: true,
    data: (data ?? []).map((r) => ({ documentId: r.document_id, courseId: r.course_id, title: r.title, page: r.page, heading: r.heading, snippet: r.snippet })),
  };
}
