import type { AiDeps } from '@/lib/ai/client';
import { aiAllowed } from '@/lib/ai/switch';
import { MAX_VISION_PDF_BYTES, PAGES_PER_CALL, PDF_TYPE, type UploadPurpose, isVisionImageType } from './constants';
import { pdfPageCount, readPdf, sha256Hex, slicePdf } from './pdf';
import { RETRY_ALONE, aiOffReason, describePages, planPages, stitchPages, type KnownPage, type PageInput, type PageRow, type PlannedPage } from './plan';
import { transcribePages, type Attachment } from './transcribe';

// One step of reading an uploaded file (PHASES.md Phase 9, part A). The first step reads the
// file and plans every page; each later step sends at most PAGES_PER_CALL pages to Claude, so
// a step fits in Vercel's 60 seconds and a long scan goes through in several steps. When no
// page is left to read, the caller stitches the pages in order. Storage and the database sit
// behind FileStore so tests run the whole thing in memory.

export interface FileDoc {
  id: string;
  user_id: string;
  course_id: string | null;
  kind: string;
  title: string;
  storage_path: string | null;
  file_name: string | null;
  file_type: string | null;
  file_size: number | null;
  meta: FileMeta;
}

export interface FileMeta {
  purpose?: UploadPurpose;
  /** A page range asked for with "Extract pages" (textbooks, or a file planned before). */
  extract?: { from: number; to: number } | null;
  page_count?: number;
  status?: string;
  summary?: string;
  lecture_on?: string | null;
  note_title?: string | null;
  note_id?: string | null;
  [key: string]: unknown;
}

export interface StoredPage extends PageRow {
  id: string;
  fingerprint: string | null;
}

export interface CourseRow {
  id: string;
  code: string;
  title?: string | null;
  ai_allowed: boolean;
}

export interface FileStore {
  document(id: string, userId: string): Promise<FileDoc | null>;
  download(path: string): Promise<Uint8Array>;
  courses(userId: string): Promise<CourseRow[]>;
  pages(documentId: string): Promise<StoredPage[]>;
  /** Inserts or replaces rows by (document_id, page). */
  savePages(doc: FileDoc, rows: PlannedPage[]): Promise<void>;
  updatePage(id: string, patch: Partial<Pick<StoredPage, 'status' | 'method' | 'text' | 'reason'>>): Promise<void>;
  /** Pages already read for the same course in other files, by fingerprint. */
  knownPages(userId: string, courseId: string | null, exceptDocumentId: string): Promise<Map<string, KnownPage>>;
  updateMeta(doc: FileDoc, meta: FileMeta): Promise<void>;
}

export interface FileAi {
  /** Null when Claude is unavailable: no key, or the month's budget is spent. */
  deps: AiDeps | null;
  unavailableReason: string | null;
}

export interface FinishedFile {
  rows: StoredPage[];
  /** Pages read for this file, in order (pages stored before are left out). */
  newText: string;
  /** Every page, including ones stored from an earlier upload. */
  allText: string;
  summary: string;
}

export type StepResult = { state: 'missing' } | { state: 'more'; summary: string } | { state: 'finished'; file: FinishedFile };

function isPdf(doc: FileDoc): boolean {
  return doc.file_type === PDF_TYPE || /\.pdf$/i.test(doc.file_name ?? '');
}

function courseLabel(course: CourseRow | undefined): string {
  return course ? `${course.code}${course.title ? ` ${course.title}` : ''}` : 'No course';
}

async function planFile(store: FileStore, doc: FileDoc, course: CourseRow | undefined, existing: StoredPage[]): Promise<void> {
  if (!doc.storage_path) throw new Error('This document has no stored file.');
  const bytes = await store.download(doc.storage_path);
  const aiOn = Boolean(course?.ai_allowed);
  const range = doc.meta.extract ?? null;

  if (!isPdf(doc)) {
    const pages: PageInput[] = [{ page: 1, text: '', fingerprint: sha256Hex(bytes) }];
    const known = await store.knownPages(doc.user_id, doc.course_id, doc.id);
    const planned = planPages({ file: 'image', imageType: doc.file_type ?? '', imageBytes: bytes.length, pages, aiOn, courseCode: course?.code ?? null, known, requested: null });
    await store.savePages(doc, planned);
    await store.updateMeta(doc, { ...doc.meta, page_count: 1 });
    return;
  }

  // A textbook is listed, not read: count its pages until a range is asked for.
  if (doc.kind === 'textbook' && !range) {
    const count = await pdfPageCount(bytes);
    const planned = Array.from({ length: count }, (_, i) => ({ page: i + 1, status: 'not_requested' as const, method: null, text: null, reason: null, fingerprint: null, same_as: null }));
    await store.savePages(doc, planned);
    await store.updateMeta(doc, { ...doc.meta, page_count: count });
    return;
  }

  const info = await readPdf(bytes);
  const requested = range ? new Set(Array.from({ length: Math.max(0, range.to - range.from + 1) }, (_, i) => range.from + i)) : null;
  // Textbook chapters are read as asked, even if a page matches another file.
  const known = doc.kind === 'textbook' ? new Map<string, KnownPage>() : await store.knownPages(doc.user_id, doc.course_id, doc.id);
  let planned = planPages({ file: 'pdf', pages: info.pages, aiOn, courseCode: course?.code ?? null, known, requested });
  // An extract request only touches its range; pages read before keep what they have.
  if (existing.length) {
    const have = new Map(existing.map((r) => [r.page, r]));
    planned = planned.filter((p) => requested?.has(p.page) && have.get(p.page)?.status === 'not_requested');
  }
  await store.savePages(doc, planned);
  await store.updateMeta(doc, { ...doc.meta, page_count: info.pageCount, extract: null });
}

async function attachmentFor(doc: FileDoc, bytes: Uint8Array, pages: number[]): Promise<Attachment | null> {
  if (!isPdf(doc)) {
    const type = doc.file_type ?? '';
    return isVisionImageType(type) ? { kind: 'image', bytes, mediaType: type } : null;
  }
  const slice = await slicePdf(bytes, pages);
  return slice.length > MAX_VISION_PDF_BYTES ? null : { kind: 'pdf', bytes: slice };
}

/**
 * Runs one step. Throws only for errors worth retrying (a single page Claude couldn't read,
 * storage down); the job runner retries, and the handler marks the page failed at the end.
 */
export async function processFileStep(store: FileStore, ai: FileAi, documentId: string, userId: string): Promise<StepResult> {
  const doc = await store.document(documentId, userId);
  if (!doc) return { state: 'missing' };
  const courses = await store.courses(userId);
  const course = courses.find((c) => c.id === doc.course_id);

  let rows = await store.pages(doc.id);
  if (!rows.length || doc.meta.extract) {
    await planFile(store, doc, course, rows);
    rows = await store.pages(doc.id);
  }

  const pending = rows.filter((r) => r.status === 'pending').sort((a, b) => a.page - b.page);
  if (pending.length) {
    // The switch is checked again right before anything leaves for Claude.
    const clearance = await aiAllowed(async (id) => courses.find((c) => c.id === id) ?? null, doc.course_id);
    if (!clearance) {
      for (const r of pending) await store.updatePage(r.id, { status: 'skipped', reason: aiOffReason(course?.code ?? null) });
    } else if (!ai.deps) {
      const reason = ai.unavailableReason ?? 'Claude is unavailable.';
      for (const r of pending) await store.updatePage(r.id, { status: 'failed', reason });
    } else {
      const batch = pending[0].reason === RETRY_ALONE ? [pending[0]] : pending.slice(0, PAGES_PER_CALL).filter((r) => r.reason !== RETRY_ALONE);
      const pages = batch.map((r) => r.page);
      const bytes = await store.download(doc.storage_path!);
      const attachment = await attachmentFor(doc, bytes, pages);
      if (!attachment) {
        if (batch.length > 1) for (const r of batch) await store.updatePage(r.id, { reason: RETRY_ALONE });
        else await store.updatePage(batch[0].id, { status: 'skipped', reason: 'This page is too large to send to Claude. It is stored as uploaded.' });
      } else {
        let result: Awaited<ReturnType<typeof transcribePages>> | null = null;
        try {
          result = await transcribePages(ai.deps, {
            userId,
            clearance,
            documentId: doc.id,
            courseLabel: courseLabel(course),
            fileName: doc.file_name ?? doc.title,
            pages,
            totalPages: doc.meta.page_count ?? rows.length,
            attachment,
          });
        } catch (e) {
          // A group that fails is split up; a single page is retried by the job runner.
          if (batch.length === 1) throw e;
          for (const r of batch) await store.updatePage(r.id, { reason: RETRY_ALONE });
        }
        if (result) {
          for (const r of batch) {
            const got = result.pages.get(r.page);
            if (got) await store.updatePage(r.id, { status: 'done', method: 'vision', text: got.markdown, reason: got.blank ? 'Blank page.' : null });
            else if (batch.length > 1) await store.updatePage(r.id, { reason: RETRY_ALONE });
            else await store.updatePage(r.id, { status: 'failed', reason: 'Claude returned nothing for this page.' });
          }
        }
      }
    }
    rows = await store.pages(doc.id);
    if (rows.some((r) => r.status === 'pending')) return { state: 'more', summary: describePages(rows) };
  }

  const single = !isPdf(doc);
  return {
    state: 'finished',
    file: {
      rows,
      newText: stitchPages(rows, { includeStored: false, single }),
      allText: stitchPages(rows, { includeStored: true, single }),
      summary: describePages(rows),
    },
  };
}

/** Marks the page a failing job was reading, so the file can finish without it. */
export async function failFirstPending(store: FileStore, documentId: string, reason: string): Promise<void> {
  const rows = await store.pages(documentId);
  const first = rows.filter((r) => r.status === 'pending').sort((a, b) => a.page - b.page)[0];
  if (first) await store.updatePage(first.id, { status: 'failed', reason });
}
