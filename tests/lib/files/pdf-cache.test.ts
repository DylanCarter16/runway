import { randomBytes } from 'node:crypto';
import { PDFDocument, PDFName, StandardFonts, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState } from 'pdf-lib';
import { PDFDataRangeTransport, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CachedFile, PDF_RANGE_OPTIONS, RANGE_CHUNK, clearPdfCache, openCachedFile, rangeTransportFor, type FileLink } from '@/lib/files/pdf-cache';

// Storage egress regression (2026-10-20): Supabase served one small file hundreds of times.
// The viewer must fetch a file's bytes at most once per session: refreshes, new signed URLs,
// remounts, page jumps, and zoom never fetch a byte twice, and a page jump fetches only what
// that page needs, by Range. Real pdf.js (the legacy build, in Node) reads through the same
// transport the viewer uses, against a fake storage server that counts every request.

vi.setConfig({ testTimeout: 60_000 });

const PAGES = 40;
/** The page with a big scanned figure: its bytes are only needed when that page is drawn. */
const FIGURE_PAGE = 30;
let PDF: Uint8Array;

/** 40 text pages, and an 800 KB incompressible greyscale image drawn on page 30. */
async function makePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= PAGES; n++) pdf.addPage([612, 792]).drawText(`Page ${n}`, { x: 72, y: 740, size: 18, font });
  const [w, h] = [1000, 800];
  const image = pdf.context.register(
    pdf.context.stream(randomBytes(w * h), { Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: 'DeviceGray', BitsPerComponent: 8 }),
  );
  const page = pdf.getPage(FIGURE_PAGE - 1);
  page.node.setXObject(PDFName.of('Fig'), image);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(400, 0, 0, 320, 72, 300), drawObject('Fig'), popGraphicsState());
  return pdf.save({ useObjectStreams: false });
}

interface Served {
  requests: { url: string; range: string | null }[];
  bytes: number;
}

/** Fake Supabase storage: signed URLs with a token, Range support (or none), expiring links. */
function storage(opts: { ranges?: boolean; expired?: Set<string>; size?: 'known' | 'unknown' } = {}) {
  const served: Served = { requests: [], bytes: 0 };
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const range = (init?.headers as Record<string, string> | undefined)?.Range ?? null;
    served.requests.push({ url, range });
    if (opts.expired?.has(url)) return new Response('{"error":"InvalidJWT"}', { status: 400 });
    const m = range && opts.ranges !== false ? /^bytes=(\d+)-(\d+)$/.exec(range) : null;
    if (m) {
      const body = PDF.slice(Number(m[1]), Number(m[2]) + 1);
      served.bytes += body.length;
      return new Response(body, { status: 206, headers: { 'Content-Range': `bytes ${m[1]}-${m[2]}/${PDF.length}` } });
    }
    served.bytes += PDF.length;
    return new Response(PDF.slice(), { status: 200 });
  };
  let n = 0;
  const links: string[] = [];
  const getLink = vi.fn(async (): Promise<FileLink> => {
    // Every call signs a new URL, like createSignedUrl does.
    const url = `https://storage.example/object/sign/library/u/doc/book.pdf?token=t${++n}`;
    links.push(url);
    return { url, size: opts.size === 'unknown' ? null : PDF.length };
  });
  return { served, fetchImpl, getLink, links };
}

/** What the viewer does to show one page: open the cached file, load it in pdf.js, draw the page (its operator list). */
async function renderPage(documentId: string, page: number, s: ReturnType<typeof storage>) {
  const file = await openCachedFile(documentId, s.getLink, s.fetchImpl);
  const errors: Error[] = [];
  const range = await rangeTransportFor(PDFDataRangeTransport, file, (e) => errors.push(e));
  const task = getDocument({ range, ...PDF_RANGE_OPTIONS, verbosity: 0 });
  try {
    const pdf = await task.promise;
    const p = await pdf.getPage(page);
    const ops = await p.getOperatorList();
    const text = (await p.getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ');
    expect(errors).toEqual([]);
    return { text, ops: ops.fnArray.length, numPages: pdf.numPages, file };
  } finally {
    await task.destroy();
  }
}

function overlaps(requests: Served['requests']): boolean {
  const spans = requests
    .map((r) => /^bytes=(\d+)-(\d+)$/.exec(r.range ?? ''))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => [Number(m[1]), Number(m[2])] as const)
    .sort((a, b) => a[0] - b[0]);
  return spans.some((s, i) => i > 0 && s[0] <= spans[i - 1][1]);
}

beforeAll(async () => {
  PDF = await makePdf();
  expect(PDF.length).toBeGreaterThan(5 * RANGE_CHUNK);
}, 60_000);

beforeEach(() => clearPdfCache());

describe('the viewer fetches a document once per session', () => {
  it('one render, then 30 refreshes with new signed URLs: one link, and no request after the first render', async () => {
    const s = storage();
    const first = await renderPage('doc-1', 1, s);
    expect(first.numPages).toBe(PAGES);
    expect(first.text).toContain('Page 1');
    const afterFirst = s.served.requests.length;
    expect(s.getLink).toHaveBeenCalledTimes(1);
    expect(afterFirst).toBeGreaterThan(0);
    // Page 1 needs neither page 30's figure nor most of the file.
    expect(s.served.bytes).toBeLessThan(PDF.length / 2);

    // The old bug: every router.refresh() signed a new URL and react-pdf downloaded the whole file again.
    for (let i = 0; i < 30; i++) expect((await renderPage('doc-1', 1, s)).text).toContain('Page 1');
    expect(s.getLink).toHaveBeenCalledTimes(1);
    expect(s.served.requests.length).toBe(afterFirst);
  });

  it('a page jump fetches only that page by Range, never a byte twice; going back and forth fetches nothing', async () => {
    const s = storage();
    await renderPage('doc-2', 1, s);
    const before = { requests: s.served.requests.length, bytes: s.served.bytes };

    const far = await renderPage('doc-2', FIGURE_PAGE, s);
    expect(far.text).toContain(`Page ${FIGURE_PAGE}`);
    expect(s.served.requests.length).toBeGreaterThan(before.requests);
    expect(s.served.requests.every((r) => r.range !== null)).toBe(true);
    expect(s.served.bytes - before.bytes).toBeGreaterThan(500_000); // the figure

    const after = s.served.requests.length;
    for (const page of [1, FIGURE_PAGE, 2, FIGURE_PAGE, 1]) await renderPage('doc-2', page, s); // jumps, zoom re-renders
    expect(s.served.requests.length).toBe(after);

    for (let page = 1; page <= PAGES; page++) await renderPage('doc-2', page, s);
    expect(s.served.bytes).toBeLessThanOrEqual(PDF.length);
    expect(overlaps(s.served.requests)).toBe(false);
    expect(s.getLink).toHaveBeenCalledTimes(1);
  });

  it('a server that ignores Range sends the whole file once, and then nothing', async () => {
    const s = storage({ ranges: false });
    for (const page of [1, FIGURE_PAGE, 12]) await renderPage('doc-3', page, s);
    expect(s.served.requests).toHaveLength(1);
    expect(s.served.bytes).toBe(PDF.length);
  });

  it('a link that expires mid-read is replaced once, and reading carries on', async () => {
    const expired = new Set<string>();
    const s = storage({ expired });
    await renderPage('doc-4', 1, s);
    expired.add(s.links[0]);
    const later = await renderPage('doc-4', FIGURE_PAGE, s);
    expect(later.text).toContain(`Page ${FIGURE_PAGE}`);
    expect(s.getLink).toHaveBeenCalledTimes(2);
  });

  it('a file with no stored size is fetched whole, once; files are cached apart', async () => {
    const s = storage({ size: 'unknown' });
    for (const page of [3, FIGURE_PAGE]) await renderPage('doc-5', page, s);
    expect(s.served.requests).toHaveLength(1);
    const file = await openCachedFile('doc-5', s.getLink, s.fetchImpl);
    expect(file).toBeInstanceOf(CachedFile);
    expect(file.complete).toBe(true);
    await renderPage('doc-6', 1, s);
    expect(s.getLink).toHaveBeenCalledTimes(2); // one link per file
  });
});
