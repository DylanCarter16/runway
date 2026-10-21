import { createHash } from 'node:crypto';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, PDFStream, type PDFObject } from 'pdf-lib';
import { extractText, getDocumentProxy } from 'unpdf';
import { MIN_TEXT_CHARS } from './constants';

// PDF reading for uploads: the text layer per page (unpdf), a fingerprint per page so a
// re-exported running notebook skips pages already stored, and page ranges cut into their
// own PDF (pdf-lib) so long scans go to Claude a few pages at a time. The original is
// never modified; everything here works on copies of its bytes.

export interface PdfPage {
  page: number;
  text: string;
  fingerprint: string;
}

export interface PdfInfo {
  pageCount: number;
  pages: PdfPage[];
}

/** True when a page's text layer has enough letters to stand in for the page. */
export function hasTextLayer(text: string): boolean {
  return (text.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= MIN_TEXT_CHARS;
}

function streamBytes(obj: PDFObject | undefined, doc: PDFDocument, out: Uint8Array[], seen: Set<string>, depth = 0) {
  if (!obj || depth > 4) return;
  if (obj instanceof PDFRef) {
    const key = obj.toString();
    if (seen.has(key)) return;
    seen.add(key);
    streamBytes(doc.context.lookup(obj), doc, out, seen, depth);
    return;
  }
  if (obj instanceof PDFRawStream) {
    out.push(obj.contents);
    // Form XObjects draw with their own resources.
    streamBytes(obj.dict.get(PDFName.of('Resources')), doc, out, seen, depth + 1);
    return;
  }
  if (obj instanceof PDFStream) {
    out.push(obj.getContents());
    return;
  }
  if (obj instanceof PDFArray) {
    for (const item of obj.asArray()) streamBytes(item, doc, out, seen, depth);
    return;
  }
  if (obj instanceof PDFDict) {
    const xobjects = obj.get(PDFName.of('XObject'));
    const dict = xobjects instanceof PDFRef ? doc.context.lookup(xobjects) : xobjects;
    if (dict instanceof PDFDict) for (const [, v] of dict.entries()) streamBytes(v, doc, out, seen, depth + 1);
  }
}

/**
 * sha256 of what a page draws: its content streams, the images and forms it uses, and its
 * text. Two exports of the same notebook give the same fingerprint for unchanged pages.
 */
function pageFingerprint(doc: PDFDocument, index: number, text: string): string {
  const page = doc.getPage(index);
  const parts: Uint8Array[] = [];
  const seen = new Set<string>();
  streamBytes(page.node.get(PDFName.of('Contents')), doc, parts, seen);
  streamBytes(page.node.get(PDFName.of('Resources')), doc, parts, seen);
  const hash = createHash('sha256');
  for (const p of parts) hash.update(p);
  hash.update('\u0000');
  hash.update(text.replace(/\s+/g, ' ').trim());
  return hash.digest('hex');
}

export async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
}

/** Page count, text layer, and fingerprint for every page. */
export async function readPdf(bytes: Uint8Array): Promise<PdfInfo> {
  const doc = await loadPdf(bytes);
  // unpdf hands the buffer to a worker-less pdf.js, which may detach it: give it a copy.
  const proxy = await getDocumentProxy(new Uint8Array(bytes));
  const { totalPages, text } = await extractText(proxy, { mergePages: false });
  const pageCount = Math.max(totalPages, doc.getPageCount());
  const pages: PdfPage[] = [];
  for (let i = 0; i < pageCount; i++) {
    // Postgres text can't hold NUL, which some fonts' text layers have: a save that always fails would retry forever.
    const t = (text[i] ?? '').replace(/\u0000/g, '').trim();
    pages.push({ page: i + 1, text: t, fingerprint: pageFingerprint(doc, Math.min(i, doc.getPageCount() - 1), t) });
  }
  return { pageCount, pages };
}

/** Just the page count (textbooks: nothing is read until a range is asked for). */
export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  return (await loadPdf(bytes)).getPageCount();
}

/** A new PDF holding only the given 1-based pages, in the order given. */
export async function slicePdf(bytes: Uint8Array, pages: number[]): Promise<Uint8Array> {
  const src = await loadPdf(bytes);
  const out = await PDFDocument.create({ updateMetadata: false });
  const copied = await out.copyPages(src, pages.map((p) => p - 1));
  for (const page of copied) out.addPage(page);
  return out.save();
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}
