import { getDocumentProxy } from 'unpdf';
import type { FileDoc, FileMeta, FileStore } from './process';
import type { PlannedPage } from './plan';
import { MIN_TEXT_CHARS } from './constants';
import { detectHeadings, headingsByPage, mergeHeadings, pageText, pdfBookmarks, textPieces, type OutlineEntry, type OutlineSourceDoc } from './outline';

// Indexing a book-sized PDF (PHASES.md Phase 10, Task 3), with no AI anywhere: each step reads
// the text layer of the next pages with unpdf's pdf.js, stores it per page with the outline
// headings that open there, and stops well inside Vercel's 60 seconds. The job re-queues until
// every page is indexed or listed with a reason. Scanned pages stay unread here; in an AI-on
// course "Extract pages" can still have Claude read them (Phase 9).

/** Pages read per step. pdf.js reads a text page in a few milliseconds; the time budget is the real cap. */
export const INDEX_PAGES_PER_STEP = 150;

/**
 * Stop reading new pages after this long. The worker keeps claiming jobs for up to 45 seconds
 * (processJobs), so a step that starts late must still end, saved, inside Vercel's 60.
 */
export const INDEX_STEP_BUDGET_MS = 10_000;

/** Headings are looked for on at most this many pages when a small file is outlined at the end. */
export const OUTLINE_SCAN_MAX_PAGES = 400;

export type IndexProgress = {
  /** Next 1-based page to read. */
  next: number;
  total: number;
  done?: boolean;
};

interface PdfProxy extends OutlineSourceDoc {
  getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }>; cleanup(): void }>;
  loadingTask: { destroy(): Promise<void> };
}

async function openPdf(bytes: Uint8Array): Promise<PdfProxy> {
  // pdf.js may detach the buffer it is given: hand it a copy.
  return (await getDocumentProxy(new Uint8Array(bytes))) as unknown as PdfProxy;
}

/** Books (`textbook`) are indexed page by page; Phase 9 reads other uploads in one pass. */
export function indexesWithoutAi(doc: FileDoc): boolean {
  const pdf = doc.file_type === 'application/pdf' || /\.pdf$/i.test(doc.file_name ?? '');
  return pdf && doc.kind === 'textbook' && !doc.meta.extract && !doc.meta.index?.done;
}

/** A page's row: its own text when it has some, otherwise unread with the reason. */
export function indexedPage(page: number, text: string, headings: string | null, aiOn: boolean, courseCode: string | null): PlannedPage {
  const base = { page, fingerprint: null, same_as: null, headings };
  const letters = text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  if (letters >= 3) {
    return { ...base, status: 'done', method: 'pdf_text', text, reason: letters < MIN_TEXT_CHARS ? 'Only a little text on this page.' : null };
  }
  if (aiOn) return { ...base, status: 'not_requested', method: null, text: null, reason: 'No text layer (a scan or a picture). Extract pages can have Claude read it.' };
  const reason = courseCode
    ? `No text layer, and ${courseCode} doesn't allow AI, so this page is stored but not read.`
    : 'No text layer, and no course is picked, so this page is stored but not read.';
  return { ...base, status: 'skipped', method: null, text: null, reason };
}

function levelOf(title: string): number {
  if (/^(chapter|part|appendix)\b/i.test(title)) return 1;
  const m = /^(\d{1,2}(?:\.\d{1,2}){0,3})\b/.exec(title);
  return m ? m[1].split('.').length : 1;
}

/** The outline from headings found page by page (stored on the rows, one per line). */
export function outlineFromPages(rows: { page: number; headings?: string | null }[]): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  for (const r of rows) for (const title of (r.headings ?? '').split('\n').filter(Boolean)) entries.push({ title, page: r.page, level: levelOf(title) });
  return mergeHeadings(entries);
}

export type IndexStepResult = { state: 'more'; summary: string } | { state: 'indexed' };

/** Reads the next pages of a book. Never calls Claude. */
export async function indexPdfStep(
  store: FileStore,
  doc: FileDoc,
  opts: { pagesPerStep?: number; budgetMs?: number } = {},
): Promise<IndexStepResult> {
  if (!doc.storage_path) throw new Error('This document has no stored file.');
  const perStep = opts.pagesPerStep ?? INDEX_PAGES_PER_STEP;
  const budget = opts.budgetMs ?? INDEX_STEP_BUDGET_MS;
  const course = (await store.courses(doc.user_id)).find((c) => c.id === doc.course_id);
  const pdf = await openPdf(await store.download(doc.storage_path));
  try {
    const meta: FileMeta = { ...doc.meta };
    let progress = meta.index;
    if (!progress) {
      const bookmarks = await pdfBookmarks(pdf);
      meta.outline = bookmarks;
      meta.outline_source = bookmarks.length ? 'bookmarks' : 'none';
      meta.page_count = pdf.numPages;
      progress = { next: 1, total: pdf.numPages };
    }
    const bookmarkHeads = meta.outline_source === 'bookmarks' ? headingsByPage(meta.outline ?? []) : null;

    const started = Date.now();
    const rows: PlannedPage[] = [];
    let page = progress.next;
    while (page <= progress.total && page < progress.next + perStep && (page === progress.next || Date.now() - started < budget)) {
      const p = await pdf.getPage(page);
      const pieces = textPieces((await p.getTextContent()).items);
      p.cleanup();
      const headings = bookmarkHeads ? (bookmarkHeads.get(page) ?? null) : detectHeadings(pieces, page).map((h) => h.title).join('\n') || null;
      rows.push(indexedPage(page, pageText(pieces), headings, Boolean(course?.ai_allowed), course?.code ?? null));
      page++;
    }
    await store.savePages(doc, rows);

    const done = page > progress.total;
    meta.index = { next: page, total: progress.total, done };
    if (done && meta.outline_source !== 'bookmarks') {
      const outline = outlineFromPages(await store.pages(doc.id));
      meta.outline = outline;
      meta.outline_source = outline.length ? 'headings' : 'none';
    }
    meta.status = done ? meta.status : 'reading';
    meta.summary = `Indexed ${page - 1} of ${progress.total} pages.`;
    await store.updateMeta(doc, meta);
    return done ? { state: 'indexed' } : { state: 'more', summary: meta.summary };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

/**
 * Outlines a PDF read the Phase 9 way (slides, handouts, notebooks) once it is finished:
 * bookmarks, or headings from its first OUTLINE_SCAN_MAX_PAGES pages. Stored in meta so the
 * viewer never rebuilds it, and written onto the page rows so search weights the headings.
 */
export async function ensureOutline(store: FileStore, doc: FileDoc): Promise<void> {
  if (doc.meta.outline_source || !doc.storage_path) return;
  const pdf = await openPdf(await store.download(doc.storage_path));
  try {
    let outline = await pdfBookmarks(pdf);
    let source: FileMeta['outline_source'] = 'bookmarks';
    if (!outline.length) {
      const found: OutlineEntry[] = [];
      for (let n = 1; n <= Math.min(pdf.numPages, OUTLINE_SCAN_MAX_PAGES); n++) {
        const p = await pdf.getPage(n);
        found.push(...detectHeadings(textPieces((await p.getTextContent()).items), n));
        p.cleanup();
      }
      outline = mergeHeadings(found);
      source = outline.length ? 'headings' : 'none';
    }
    const heads = headingsByPage(outline);
    for (const row of await store.pages(doc.id)) {
      const h = heads.get(row.page) ?? null;
      if (h !== (row.headings ?? null)) await store.updatePage(row.id, { headings: h });
    }
    await store.updateMeta(doc, { ...doc.meta, outline, outline_source: source });
  } finally {
    await pdf.loadingTask.destroy();
  }
}

/** A step that kept failing on a book: mark the page it was on as failed and move past it. */
export async function skipIndexPage(store: FileStore, doc: FileDoc, reason: string): Promise<void> {
  const progress = doc.meta.index ?? { next: 1, total: doc.meta.page_count ?? 1 };
  const page = Math.min(progress.next, progress.total);
  await store.savePages(doc, [{ page, status: 'failed', method: null, text: null, reason, fingerprint: null, same_as: null, headings: null }]);
  const next = page + 1;
  await store.updateMeta(doc, { ...doc.meta, index: { ...progress, next, done: next > progress.total } });
}
