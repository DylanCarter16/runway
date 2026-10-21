// A PDF's outline for the document viewer (PHASES.md Phase 10, Task 3), with no AI: the
// PDF's own bookmarks when it has them, otherwise numbered headings ("4 The Processor",
// "4.2 Logic Conventions", "Chapter 4 ...") found in its text layer by font size.

export type OutlineEntry = {
  title: string;
  /** 1-based page the entry opens. */
  page: number;
  /** 1 for chapters, 2 for sections, and so on. */
  level: number;
};

export type OutlineSource = 'bookmarks' | 'headings' | 'none';

/** One piece of a page's text layer (pdf.js TextItem, reduced to what heading detection needs). */
export interface TextPiece {
  str: string;
  /** Font size in PDF units: the length of the text matrix's vertical vector. */
  size: number;
  /** Baseline y in PDF units. */
  y: number;
  hasEOL: boolean;
}

interface PdfTextItem {
  str?: string;
  transform?: number[];
  hasEOL?: boolean;
}

/** The pieces of a pdf.js `getTextContent()` result, skipping marked-content entries. */
export function textPieces(items: unknown[]): TextPiece[] {
  const out: TextPiece[] = [];
  for (const raw of items) {
    const item = raw as PdfTextItem;
    if (typeof item.str !== 'string' || !Array.isArray(item.transform)) continue;
    const [, , c, d, , f] = item.transform;
    out.push({ str: item.str, size: Math.hypot(c, d), y: f, hasEOL: Boolean(item.hasEOL) });
  }
  return out;
}

/** A page's text the way unpdf's extractText builds it, so stored text matches Phase 9's. */
export function pageText(pieces: TextPiece[]): string {
  // No NUL: Postgres text can't store it (see readPdf).
  return pieces.map((p) => p.str + (p.hasEOL ? '\n' : '')).join('').replace(/\u0000/g, '').trim();
}

interface Line {
  text: string;
  size: number;
}

function lines(pieces: TextPiece[]): Line[] {
  const out: Line[] = [];
  let cur: { parts: string[]; size: number; y: number } | null = null;
  const flush = () => {
    if (cur) {
      const text = cur.parts.join('').replace(/\s+/g, ' ').trim();
      if (text) out.push({ text, size: cur.size });
    }
    cur = null;
  };
  for (const p of pieces) {
    if (cur && Math.abs(p.y - cur.y) > Math.max(2, p.size * 0.5)) flush();
    if (!cur) cur = { parts: [], size: 0, y: p.y };
    cur.parts.push(p.str);
    if (p.str.trim()) cur.size = Math.max(cur.size, p.size);
    if (p.hasEOL) flush();
  }
  flush();
  return out;
}

/** The size most of the page's letters are set in. */
export function bodySize(pieces: TextPiece[]): number {
  const chars = new Map<number, number>();
  for (const p of pieces) {
    const n = p.str.replace(/\s/g, '').length;
    if (!n) continue;
    const size = Math.round(p.size * 2) / 2;
    chars.set(size, (chars.get(size) ?? 0) + n);
  }
  let best = 0;
  let most = -1;
  for (const [size, n] of chars) if (n > most || (n === most && size < best)) [best, most] = [size, n];
  return best;
}

const NUMBERED = /^(\d{1,2}(?:\.\d{1,2}){0,3})\.?\s+(\S.*)$/;
const CHAPTER = /^(chapter|part|appendix)\s+([0-9]{1,2}|[A-Z]|[IVX]{1,5})\b[.:]?\s*(.*)$/i;
/** Headings sit clearly above body text. */
const HEADING_RATIO = 1.15;

/**
 * Numbered headings on one page, top to bottom. A line counts when it starts with a section
 * number (or "Chapter N"), is short, has letters after the number, isn't a table-of-contents
 * line (dot leaders or a trailing page number), and is set larger than the page's body text.
 */
export function detectHeadings(pieces: TextPiece[], page: number): OutlineEntry[] {
  const body = bodySize(pieces);
  if (!body) return [];
  const out: OutlineEntry[] = [];
  for (const line of lines(pieces)) {
    if (line.size < body * HEADING_RATIO) continue;
    const text = line.text;
    if (text.length < 3 || text.length > 90) continue;
    if (/\.{3,}|…/.test(text) || /\s\d{1,4}$/.test(text)) continue;
    const chapter = CHAPTER.exec(text);
    if (chapter) {
      out.push({ title: text, page, level: 1 });
      continue;
    }
    const numbered = NUMBERED.exec(text);
    if (!numbered || !/\p{L}{2,}/u.test(numbered[2])) continue;
    out.push({ title: text, page, level: numbered[1].split('.').length });
  }
  return out;
}

function normalize(title: string): string {
  return title.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Every page's detected headings as one outline: first appearance wins (running headers repeat). */
export function mergeHeadings(entries: OutlineEntry[]): OutlineEntry[] {
  const seen = new Set<string>();
  const out: OutlineEntry[] = [];
  for (const e of [...entries].sort((a, b) => a.page - b.page)) {
    const key = normalize(e.title);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/** The outline titles that open on each page, one per line, for weighted page search. */
export function headingsByPage(outline: OutlineEntry[]): Map<number, string> {
  const byPage = new Map<number, string[]>();
  for (const e of outline) byPage.set(e.page, [...(byPage.get(e.page) ?? []), e.title]);
  return new Map([...byPage].map(([page, titles]) => [page, titles.join('\n')]));
}

interface PdfOutlineNode {
  title?: string;
  dest?: string | unknown[] | null;
  items?: PdfOutlineNode[];
}

/** The parts of pdf.js's PDFDocumentProxy that bookmarks need. */
export interface OutlineSourceDoc {
  numPages: number;
  getOutline(): Promise<unknown[] | null>;
  getDestination(id: string): Promise<unknown[] | null>;
  getPageIndex(ref: { num: number; gen: number }): Promise<number>;
}

/** Most entries a stored outline keeps; big books have a few hundred. */
export const MAX_OUTLINE_ENTRIES = 2000;

async function destPage(doc: OutlineSourceDoc, dest: PdfOutlineNode['dest']): Promise<number | null> {
  try {
    const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || !explicit.length) return null;
    const target = explicit[0];
    const index =
      typeof target === 'number'
        ? target
        : target && typeof target === 'object' && 'num' in target
          ? await doc.getPageIndex(target as { num: number; gen: number })
          : null;
    if (index === null || index < 0 || index >= doc.numPages) return null;
    return index + 1;
  } catch {
    return null;
  }
}

/** The PDF's bookmarks, flattened in reading order with their depth. Entries with no page are dropped. */
export async function pdfBookmarks(doc: OutlineSourceDoc): Promise<OutlineEntry[]> {
  let roots: unknown[] | null = null;
  try {
    roots = await doc.getOutline();
  } catch {
    return [];
  }
  const out: OutlineEntry[] = [];
  const walk = async (nodes: PdfOutlineNode[], level: number) => {
    for (const node of nodes) {
      if (out.length >= MAX_OUTLINE_ENTRIES) return;
      const title = (node.title ?? '').replace(/\s+/g, ' ').trim();
      const page = await destPage(doc, node.dest);
      if (title && page) out.push({ title: title.slice(0, 200), page, level });
      if (node.items?.length) await walk(node.items, level + 1);
    }
  };
  await walk((roots ?? []) as PdfOutlineNode[], 1);
  return out;
}
