import 'server-only';
import { createHash } from 'node:crypto';
import { createAdminClient } from '@/lib/db/admin';
import { LIBRARY_BUCKET } from '@/lib/files/constants';
import { indexesWithoutAi, skipIndexPage } from '@/lib/files/index-pdf';
import { failFirstPending, fileStep, processFileStep, type FileAi, type FileDoc, type FileMeta, type FileStore, type FinishedFile, type StoredPage } from '@/lib/files/process';
import type { KnownPage } from '@/lib/files/plan';
import type { Json } from '@/lib/db/types';
import { rebuildDocumentChunks, rebuildNoteChunks } from '@/lib/notes/store';
import { aiConfigured, liveAiDeps, monthSpendUsd, overBudget } from './ai';
import { enqueueNoteMeta } from './notes';
import { JOB_REMINDERS } from './gcal';
import { enqueue, type Admin, type JobHandler } from './queue';

// Reading uploaded files (PHASES.md Phase 9, part A; books indexed page by page in Phase 10).
// Each job runs one step of fileStep and queues the next until no page is left, then stitches the pages,
// builds the chunks Ask and search use, and, for files added from the note form, makes
// the note from the pages that are new.

export const JOB_FILE_PROCESS = 'files.process';

export function fileJob(userId: string, documentId: string, step = 0) {
  return { userId, type: JOB_FILE_PROCESS, payload: { documentId, step }, dedupeKey: `files:${documentId}:${step}`, maxAttempts: 3 };
}

export function adminFileStore(admin: Admin): FileStore {
  return {
    async document(id, userId) {
      const { data, error } = await admin
        .from('documents')
        .select('id, user_id, course_id, kind, title, storage_path, file_name, file_type, file_size, meta')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw new Error(`Could not read the file: ${error.message}`);
      return data ? ({ ...data, meta: (data.meta ?? {}) as FileMeta } as FileDoc) : null;
    },
    async download(path) {
      const { data, error } = await admin.storage.from(LIBRARY_BUCKET).download(path);
      if (error || !data) throw new Error(`Could not download the file: ${error?.message ?? 'no data'}`);
      return new Uint8Array(await data.arrayBuffer());
    },
    async courses(userId) {
      const { data, error } = await admin.from('courses').select('id, code, title, ai_allowed').eq('user_id', userId);
      if (error) throw new Error(`Could not read courses: ${error.message}`);
      return data ?? [];
    },
    async pages(documentId) {
      const { data, error } = await admin
        .from('document_pages')
        .select('id, page, status, method, text, reason, fingerprint, headings')
        .eq('document_id', documentId)
        .order('page');
      if (error) throw new Error(`Could not read the pages: ${error.message}`);
      return (data ?? []) as StoredPage[];
    },
    async savePages(doc, rows) {
      if (!rows.length) return;
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await admin.from('document_pages').upsert(
          rows.slice(i, i + 500).map((r) => ({ ...r, user_id: doc.user_id, document_id: doc.id })),
          { onConflict: 'document_id,page' },
        );
        if (error) throw new Error(`Could not save the pages: ${error.message}`);
      }
    },
    async updatePage(id, patch) {
      const { error } = await admin.from('document_pages').update(patch).eq('id', id);
      if (error) throw new Error(`Could not update a page: ${error.message}`);
    },
    async knownPages(userId, courseId, exceptDocumentId) {
      let q = admin
        .from('document_pages')
        .select('id, fingerprint, text, documents!inner(course_id, kind)')
        .eq('user_id', userId)
        .neq('document_id', exceptDocumentId)
        .in('status', ['done', 'already_stored'])
        .not('fingerprint', 'is', null)
        .neq('documents.kind', 'textbook');
      q = courseId ? q.eq('documents.course_id', courseId) : q.is('documents.course_id', null);
      const { data, error } = await q;
      if (error) throw new Error(`Could not read earlier pages: ${error.message}`);
      const known = new Map<string, KnownPage>();
      for (const r of data ?? []) if (r.fingerprint && !known.has(r.fingerprint)) known.set(r.fingerprint, { id: r.id, text: r.text });
      return known;
    },
    async updateMeta(doc, meta) {
      const { error } = await admin.from('documents').update({ meta: meta as Json }).eq('id', doc.id);
      if (error) throw new Error(`Could not save the file's status: ${error.message}`);
    },
  };
}

async function fileAi(admin: Admin, userId: string): Promise<FileAi> {
  if (!aiConfigured()) return { deps: null, unavailableReason: 'Claude is not set up yet (no API key), so this page was not transcribed.' };
  if (overBudget(await monthSpendUsd(admin, userId))) return { deps: null, unavailableReason: "This month's AI budget is spent, so this page was not transcribed." };
  return { deps: liveAiDeps(admin), unavailableReason: null };
}

function pageList(pages: number[]): string {
  if (!pages.length) return '';
  const sorted = [...pages].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] + 1) continue;
    parts.push(start === sorted[i - 1] ? `${start}` : `${start}–${sorted[i - 1]}`);
    start = sorted[i];
  }
  return parts.join(', ');
}

export type FileNoteMode = 'new' | 'whole';

/**
 * The note for a file added from the note form. The original names the file and which pages
 * it covers; for AI-on courses the transcribed pages are the cleaned copy (PHASES.md Phase 9
 * part B: new PDF material can go to the cleaned copy alone). AI-off courses keep any text
 * the PDF had in the original, since they have no cleaned copy.
 */
export function fileNoteContent(doc: Pick<FileDoc, 'id' | 'file_name' | 'title'>, file: FinishedFile, aiOn: boolean, mode: FileNoteMode) {
  const rows = file.rows;
  const newPages = rows.filter((r) => r.status === 'done').map((r) => r.page);
  const stored = rows.filter((r) => r.status === 'already_stored').map((r) => r.page);
  const name = doc.file_name ?? doc.title;
  const scope =
    mode === 'whole' || !stored.length
      ? `${rows.length === 1 ? '1 page' : `all ${rows.length} pages`}`
      : `pages ${pageList(newPages)} of ${rows.length} (pages ${pageList(stored)} were stored from an earlier upload)`;
  const header = `Uploaded file: [${name}](/library/${doc.id}), ${scope}.`;
  const text = mode === 'whole' ? file.allText : file.newText;
  if (aiOn) return { original_md: header, cleaned_md: text || null };
  return { original_md: text ? `${header}\n\n${text}` : header, cleaned_md: null };
}

export async function createFileNote(admin: Admin, doc: FileDoc, file: FinishedFile, aiOn: boolean, mode: FileNoteMode): Promise<string | null> {
  const content = fileNoteContent(doc, file, aiOn, mode);
  const lectureOn = typeof doc.meta.lecture_on === 'string' ? doc.meta.lecture_on : null;
  const newPages = file.rows.filter((r) => r.status === 'done').length;
  const storedPages = file.rows.filter((r) => r.status === 'already_stored').length;
  const { data, error } = await admin
    .from('notes')
    .insert({
      user_id: doc.user_id,
      course_id: doc.course_id,
      lecture_on: lectureOn,
      // Without a title the note would be named after its first line, the Markdown header.
      title: doc.meta.note_title || (doc.file_name ?? doc.title).replace(/\.[a-z0-9]+$/i, ''),
      original_md: content.original_md,
      cleaned_md: content.cleaned_md,
      cleanup_status: content.cleaned_md ? 'done' : 'pending',
      cleanup_model: content.cleaned_md ? 'transcription' : null,
      cleaned_at: content.cleaned_md ? new Date().toISOString() : null,
      content_hash: createHash('sha256').update(`${content.original_md}\n${content.cleaned_md ?? ''}`).digest('hex'),
      source_document_id: doc.id,
      incremental: { kind: 'file', mode, new_pages: newPages, stored_pages: storedPages, summary: file.summary } as Json,
    })
    .select('id, user_id, course_id, original_md, cleaned_md, edited_md')
    .single();
  if (error) {
    if (error.code === '23505') return null;
    throw new Error(`Could not save the note: ${error.message}`);
  }
  await rebuildNoteChunks(admin, data);
  if (aiOn && content.cleaned_md) await enqueueNoteMeta(admin, doc.user_id, data.id);
  await enqueue(admin, { userId: doc.user_id, type: JOB_REMINDERS, dedupeKey: 'reminders:generate' });
  return data.id;
}

async function finishFile(admin: Admin, store: FileStore, doc: FileDoc, file: FinishedFile): Promise<void> {
  const courses = await store.courses(doc.user_id);
  const aiOn = Boolean(courses.find((c) => c.id === doc.course_id)?.ai_allowed);
  const meta: FileMeta = { ...doc.meta, status: 'done', summary: file.summary, page_count: file.rows.length, extract: null };

  if (doc.meta.purpose === 'note' && !doc.meta.note_id) {
    // The note carries the searchable text, so the file itself isn't chunked (no double citations).
    const nothingNew = !file.rows.some((r) => r.status === 'done') && file.rows.some((r) => r.status === 'already_stored');
    if (nothingNew) meta.note_outcome = 'nothing_new';
    else meta.note_id = await createFileNote(admin, doc, file, aiOn, 'new');
  } else if (doc.meta.purpose !== 'note') {
    await rebuildDocumentChunks(admin, { id: doc.id, user_id: doc.user_id, course_id: doc.course_id, kind: doc.kind, raw_text: file.newText, source_ref: null });
  }

  const { error } = await admin
    .from('documents')
    .update({ meta: meta as Json, processed_at: new Date().toISOString() })
    .eq('id', doc.id);
  if (error) throw new Error(`Could not save the file's status: ${error.message}`);
}

const fileHandler: JobHandler = async (admin, job) => {
  const { documentId, step = 0 } = job.payload as { documentId?: string; step?: number };
  if (!documentId) throw new Error('Job has no documentId.');
  const store = adminFileStore(admin);
  const ai = await fileAi(admin, job.user_id);

  let result;
  try {
    result = await fileStep(store, ai, documentId, job.user_id);
  } catch (e) {
    if (job.attempts < job.max_attempts) throw e;
    // Out of tries on one page: mark it and carry on with the rest of the file.
    const message = e instanceof Error ? e.message : String(e);
    const reason = `Could not read this page: ${message.slice(0, 300)}`;
    const failing = await store.document(documentId, job.user_id);
    if (failing && indexesWithoutAi(failing)) await skipIndexPage(store, failing, reason);
    else await failFirstPending(store, documentId, reason);
    await enqueue(admin, fileJob(job.user_id, documentId, step + 1));
    return;
  }

  if (result.state === 'missing') return;
  const doc = (await store.document(documentId, job.user_id))!;
  if (result.state === 'more') {
    await store.updateMeta(doc, { ...doc.meta, status: 'reading', summary: result.summary });
    await enqueue(admin, fileJob(job.user_id, documentId, step + 1));
    return;
  }
  await finishFile(admin, store, doc, result.file);
};

export const FILE_HANDLERS: Record<string, JobHandler> = { [JOB_FILE_PROCESS]: fileHandler };

/** Queues reading a file (a new upload, an extract request, or a retry); returns the admin client for after(). */
export async function queueFile(userId: string, documentId: string): Promise<Admin> {
  const admin = createAdminClient();
  await enqueue(admin, fileJob(userId, documentId, 0));
  return admin;
}

/**
 * "Keep the whole file as one note": a note from every page of a finished upload, including
 * pages stored from an earlier upload. Returns null while pages are still being read.
 */
export async function keepWholeFileNote(userId: string, documentId: string): Promise<string | null> {
  const admin = createAdminClient();
  const store = adminFileStore(admin);
  const doc = await store.document(documentId, userId);
  if (!doc) return null;
  const rows = await store.pages(doc.id);
  if (!rows.length || rows.some((r) => r.status === 'pending')) return null;
  const result = await processFileStep(store, { deps: null, unavailableReason: null }, doc.id, userId);
  if (result.state !== 'finished') return null;
  const courses = await store.courses(userId);
  const aiOn = Boolean(courses.find((c) => c.id === doc.course_id)?.ai_allowed);
  const id = await createFileNote(admin, doc, result.file, aiOn, 'whole');
  if (id) await store.updateMeta(doc, { ...doc.meta, note_id: id, note_outcome: 'whole' });
  return id;
}
