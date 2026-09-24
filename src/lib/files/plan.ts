import { MAX_VISION_IMAGE_BYTES, isVisionImageType } from './constants';
import { hasTextLayer } from './pdf';

// Pure decisions for an uploaded file's pages (PHASES.md Phase 9): which pages are read from
// the PDF's own text, which go to Claude vision, which were stored before (a re-exported
// notebook), and which are skipped and why. Also the stitched text and the summary line.

export type PageStatus = 'pending' | 'done' | 'skipped' | 'failed' | 'already_stored' | 'not_requested';
export type PageMethod = 'pdf_text' | 'vision';

export interface PageInput {
  page: number;
  text: string;
  fingerprint: string | null;
}

export interface KnownPage {
  id: string;
  text: string | null;
}

export interface PlannedPage {
  page: number;
  status: PageStatus;
  method: PageMethod | null;
  text: string | null;
  reason: string | null;
  fingerprint: string | null;
  same_as: string | null;
}

export interface PlanOptions {
  file: 'pdf' | 'image';
  imageType?: string;
  imageBytes?: number;
  pages: PageInput[];
  /** The course's AI switch; null course counts as off. */
  aiOn: boolean;
  courseCode: string | null;
  /** Pages stored before for this course, by fingerprint. */
  known: Map<string, KnownPage>;
  /** Only these pages are read (textbook ranges); null reads every page. */
  requested: Set<number> | null;
}

/** Kept on a page that failed in a group, so the next step sends it on its own. */
export const RETRY_ALONE = 'Retrying this page on its own.';

export function aiOffReason(courseCode: string | null): string {
  return courseCode
    ? `${courseCode} doesn't allow AI, so this page is stored but not transcribed.`
    : 'No course is picked, so this page is stored but not transcribed. Pick a course with AI on to read it.';
}

export function planPages(o: PlanOptions): PlannedPage[] {
  return o.pages.map((p) => {
    const base = { page: p.page, fingerprint: p.fingerprint, same_as: null, method: null, text: null, reason: null };
    if (o.requested && !o.requested.has(p.page)) return { ...base, status: 'not_requested' };
    const known = p.fingerprint ? o.known.get(p.fingerprint) : undefined;
    if (known) return { ...base, status: 'already_stored', same_as: known.id, text: known.text, reason: 'Already stored from an earlier upload.' };
    if (o.file === 'pdf' && hasTextLayer(p.text)) return { ...base, status: 'done', method: 'pdf_text', text: p.text };
    if (!o.aiOn) return { ...base, status: 'skipped', reason: aiOffReason(o.courseCode) };
    if (o.file === 'image') {
      if (!o.imageType || !isVisionImageType(o.imageType)) {
        return { ...base, status: 'skipped', reason: "Claude can't read this image type. Export it as JPEG or PNG and upload that." };
      }
      if ((o.imageBytes ?? 0) > MAX_VISION_IMAGE_BYTES) {
        return { ...base, status: 'skipped', reason: 'The image is over 5 MB, too large for Claude to read. It is stored as uploaded.' };
      }
    }
    return { ...base, status: 'pending', method: 'vision' };
  });
}

export interface PageRow {
  id?: string;
  page: number;
  status: PageStatus;
  method: PageMethod | null;
  text: string | null;
  reason: string | null;
}

function byPage<T extends { page: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.page - b.page);
}

/**
 * The file's text in page order, each page under a "Page N" heading so search results and
 * citations say where a passage is. `includeStored` adds pages stored from an earlier upload.
 */
export function stitchPages(rows: PageRow[], opts: { includeStored: boolean; single?: boolean }): string {
  const parts: string[] = [];
  for (const r of byPage(rows)) {
    const usable = r.status === 'done' || (opts.includeStored && r.status === 'already_stored');
    if (!usable || !r.text?.trim()) continue;
    parts.push(opts.single ? r.text.trim() : `## Page ${r.page}\n\n${r.text.trim()}`);
  }
  return parts.join('\n\n');
}

function ranges(pages: number[]): string {
  const sorted = [...pages].sort((a, b) => a - b);
  const out: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (const p of sorted.slice(1).concat(Number.NaN)) {
    if (p === prev + 1) {
      prev = p;
      continue;
    }
    out.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = p;
    prev = p;
  }
  return out.join(', ');
}

/** What happened to the file, e.g. "7 pages: 7 transcribed by Claude." */
export function describePages(rows: PageRow[]): string {
  const total = rows.length;
  const pick = (f: (r: PageRow) => boolean) => rows.filter(f).map((r) => r.page);
  const pdfText = pick((r) => r.status === 'done' && r.method === 'pdf_text');
  const vision = pick((r) => r.status === 'done' && r.method === 'vision');
  const stored = pick((r) => r.status === 'already_stored');
  const notRequested = pick((r) => r.status === 'not_requested');
  const skipped = byPage(rows.filter((r) => r.status === 'skipped' || r.status === 'failed'));
  const pending = pick((r) => r.status === 'pending');

  const done: string[] = [];
  if (pdfText.length) done.push(`${pdfText.length} read from the PDF text`);
  if (vision.length) done.push(`${vision.length} transcribed by Claude`);
  if (stored.length) done.push(`${stored.length} already stored (pages ${ranges(stored)})`);
  if (notRequested.length) done.push(`${notRequested.length} not read yet`);
  if (pending.length) done.push(`${pending.length} still being read`);

  const head = total === 1 ? '1 page' : `${total} pages`;
  let line = done.length ? `${head}: ${done.join(', ')}.` : `${head}.`;
  if (skipped.length) {
    // Group pages that share a reason: "Skipped pages 1–7: CS 251 doesn't allow AI, ...".
    const byReason = new Map<string, number[]>();
    for (const r of skipped) byReason.set(r.reason ?? 'No reason given.', [...(byReason.get(r.reason ?? 'No reason given.') ?? []), r.page]);
    for (const [reason, pages] of byReason) line += ` Skipped ${pages.length === 1 ? 'page' : 'pages'} ${ranges(pages)}: ${reason}`;
  }
  return line;
}
