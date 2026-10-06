import { PDFDocument, PDFHexString, PDFName, StandardFonts, type PDFDict, type PDFRef } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AiDeps } from '@/lib/ai/client';
import { indexPdfStep, outlineFromPages } from '@/lib/files/index-pdf';
import { bodySize, detectHeadings, mergeHeadings, type TextPiece } from '@/lib/files/outline';
import { fileStep, type FileAi, type FileDoc, type StepResult } from '@/lib/files/process';
import { MemoryFileStore } from './memory-store';

// Phase 10, Task 3: books are indexed page by page with no AI, outlined from their bookmarks or
// numbered headings, and every page ends up indexed or listed with a reason.

const callClaude = vi.hoisted(() => vi.fn());
vi.mock('@/lib/ai/client', async (original) => ({ ...(await original<typeof import('@/lib/ai/client')>()), callClaude }));
const transcribePages = vi.hoisted(() => vi.fn());
vi.mock('@/lib/files/transcribe', async (original) => ({ ...(await original<typeof import('@/lib/files/transcribe')>()), transcribePages }));

const USER = 'u1';
const CS251 = 'course-cs251';
const CS246 = 'course-cs246';
const STAT = 'course-stat230';
const COURSES = [
  { id: STAT, code: 'STAT 230', title: 'Probability', ai_allowed: true },
  { id: CS251, code: 'CS 251', title: 'Computer Organization and Design', ai_allowed: false },
  { id: CS246, code: 'CS 246', title: 'Object-Oriented Software Development', ai_allowed: false },
];
const PAGES = 520;
const PHRASE = 'forwarding resolves the load-use hazard after one stall cycle';
const CHAPTERS = [
  { page: 1, title: '1 Computer Abstractions and Technology' },
  { page: 120, title: '2 Instructions: Language of the Computer' },
  { page: 230, title: '4 The Processor' },
  { page: 236, title: '4.5 An Overview of Pipelining' },
  { page: 400, title: '5 Large and Fast: Exploiting Memory Hierarchy' },
];
const BLANK = new Set([3, 4]); // a scanned plate: no text layer

/** A spy for every way a call could reach Claude, plus the log that writes ai_calls rows. */
function spyAi(): { ai: FileAi; deps: AiDeps } {
  const deps: AiDeps = { send: vi.fn(async () => { throw new Error('Claude must not be called'); }), log: vi.fn(async () => undefined) };
  return { ai: { deps, unavailableReason: null }, deps };
}

function book(id: string, courseId: string, size: number, over: Partial<FileDoc> = {}): FileDoc {
  return {
    id,
    user_id: USER,
    course_id: courseId,
    kind: 'textbook',
    title: 'Computer Organization and Design',
    storage_path: `${USER}/${id}/book.pdf`,
    file_name: 'book.pdf',
    file_type: 'application/pdf',
    file_size: size,
    meta: { purpose: 'textbook' },
    ...over,
  };
}

/** A textbook-sized PDF: numbered chapter headings in 20 pt, body text in 11 pt, a running header, two blank plates. */
async function makeBook(pages = PAGES): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (let n = 1; n <= pages; n++) {
    const page = pdf.addPage([612, 792]);
    if (BLANK.has(n)) continue;
    // A running header in body size repeats the chapter on every page; it must not become an outline entry.
    page.drawText(`4.5 An Overview of Pipelining ${n}`, { x: 72, y: 760, size: 9, font });
    const heading = CHAPTERS.find((c) => c.page === n);
    let y = 700;
    if (heading) {
      page.drawText(heading.title, { x: 72, y, size: 20, font: bold });
      y -= 40;
    }
    const lines = [
      `Page ${n} body text about datapaths, registers, and memory.`,
      n === 237 ? `In practice ${PHRASE}.` : 'Numbers in a list: 1 apple, 2 pears, 3 plums.',
      '3 Items numbered in body text are not headings.',
    ];
    for (const line of lines) {
      page.drawText(line, { x: 72, y, size: 11, font });
      y -= 16;
    }
  }
  return pdf.save();
}

interface Mark {
  title: string;
  page: number;
  children?: Mark[];
}

/** Adds real PDF bookmarks (an /Outlines tree) pointing at pages. */
function addBookmarks(pdf: PDFDocument, marks: Mark[]) {
  const ctx = pdf.context;
  const build = (items: Mark[], parent: PDFRef): PDFRef[] => {
    const refs = items.map(() => ctx.nextRef());
    items.forEach((m, i) => {
      const dict = ctx.obj({ Title: PDFHexString.fromText(m.title), Parent: parent, Dest: [pdf.getPage(m.page - 1).ref, 'XYZ', null, null, null] }) as PDFDict;
      if (i > 0) dict.set(PDFName.of('Prev'), refs[i - 1]);
      if (i < refs.length - 1) dict.set(PDFName.of('Next'), refs[i + 1]);
      if (m.children?.length) {
        const kids = build(m.children, refs[i]);
        dict.set(PDFName.of('First'), kids[0]);
        dict.set(PDFName.of('Last'), kids[kids.length - 1]);
        dict.set(PDFName.of('Count'), ctx.obj(kids.length));
      }
      ctx.assign(refs[i], dict);
    });
    return refs;
  };
  const root = ctx.nextRef();
  const top = build(marks, root);
  ctx.assign(root, ctx.obj({ Type: 'Outlines', First: top[0], Last: top[top.length - 1], Count: top.length }));
  pdf.catalog.set(PDFName.of('Outlines'), root);
}

async function runToEnd(store: MemoryFileStore, ai: FileAi, id: string, summaries: string[] = []) {
  for (let step = 0; step < 50; step++) {
    const r: StepResult = await fileStep(store, ai, id, USER);
    if (r.state === 'finished') return { result: r, steps: step + 1 };
    if (r.state === 'missing') throw new Error('missing');
    summaries.push(r.summary);
  }
  throw new Error('did not finish in 50 steps');
}

let BOOK: Uint8Array;
beforeAll(async () => {
  BOOK = await makeBook();
}, 60_000);

describe('a textbook-sized PDF (520 pages, CS 251, AI off)', () => {
  it('indexes every page across several steps, shows progress, and outlines its numbered headings', async () => {
    const store = new MemoryFileStore(COURSES);
    store.addFile(book('cs251-book', CS251, BOOK.length), BOOK);
    const { ai, deps } = spyAi();
    const summaries: string[] = [];

    const { result, steps } = await runToEnd(store, ai, 'cs251-book', summaries);

    expect(steps).toBe(4); // 150 + 150 + 150 + 70 pages, the last step also finishing the file
    expect(summaries).toEqual(['Indexed 150 of 520 pages.', 'Indexed 300 of 520 pages.', 'Indexed 450 of 520 pages.']);
    const rows = result.file.rows;
    expect(rows).toHaveLength(PAGES);
    expect(rows.map((r) => r.page)).toEqual(Array.from({ length: PAGES }, (_, i) => i + 1));
    // Every page is indexed or listed with a reason.
    for (const r of rows) {
      if (BLANK.has(r.page)) {
        expect(r.status).toBe('skipped');
        expect(r.reason).toBe("No text layer, and CS 251 doesn't allow AI, so this page is stored but not read.");
      } else {
        expect(r.status, `page ${r.page}`).toBe('done');
        expect(r.method).toBe('pdf_text');
      }
    }
    expect(rows.find((r) => r.page === 237)!.text).toContain(PHRASE);
    expect(result.file.summary).toBe("520 pages: 518 read from the PDF text. Skipped pages 3–4: No text layer, and CS 251 doesn't allow AI, so this page is stored but not read.");

    const meta = store.docs.get('cs251-book')!.meta;
    expect(meta.index).toEqual({ next: 521, total: 520, done: true });
    expect(meta.outline_source).toBe('headings');
    expect(meta.outline).toEqual(CHAPTERS.map((c) => ({ title: c.title, page: c.page, level: c.title.startsWith('4.5') ? 2 : 1 })));
    expect(store.rows.size).toBe(PAGES);
    const p230 = [...store.rows.values()].find((r) => r.page === 230)!;
    expect(p230.headings).toBe('4 The Processor');

    expect(deps.send).not.toHaveBeenCalled();
    expect(deps.log).not.toHaveBeenCalled();
    expect(callClaude).not.toHaveBeenCalled();
    expect(transcribePages).not.toHaveBeenCalled();
  }, 120_000);

  it('a step stops early when its time budget runs out, and the next step carries on', async () => {
    const store = new MemoryFileStore(COURSES);
    const small = await makeBook(12);
    store.addFile(book('b', CS251, small.length), small);
    const doc = (await store.document('b', USER))!;
    const first = await indexPdfStep(store, doc, { budgetMs: 0 });
    // A zero budget still reads one page, so every step makes progress.
    expect(first).toEqual({ state: 'more', summary: 'Indexed 1 of 12 pages.' });
    const second = await indexPdfStep(store, (await store.document('b', USER))!, { budgetMs: 60_000 });
    expect(second).toEqual({ state: 'indexed' });
    expect(store.rows.size).toBe(12);
  }, 60_000);
});

describe('outlines', () => {
  it('uses the PDF bookmarks when it has them, nested, and puts their titles on their pages', async () => {
    const pdf = await PDFDocument.load(await makeBook(20));
    addBookmarks(pdf, [
      { title: 'Preface', page: 2 },
      { title: 'The Processor', page: 9, children: [{ title: 'Pipelining', page: 12 }] },
    ]);
    const bytes = await pdf.save();
    const store = new MemoryFileStore(COURSES);
    store.addFile(book('marked', CS246, bytes.length), bytes);
    const { ai, deps } = spyAi();
    await runToEnd(store, ai, 'marked');
    const meta = store.docs.get('marked')!.meta;
    expect(meta.outline_source).toBe('bookmarks');
    expect(meta.outline).toEqual([
      { title: 'Preface', page: 2, level: 1 },
      { title: 'The Processor', page: 9, level: 1 },
      { title: 'Pipelining', page: 12, level: 2 },
    ]);
    const headings = new Map([...store.rows.values()].map((r) => [r.page, r.headings]));
    expect(headings.get(9)).toBe('The Processor');
    expect(headings.get(12)).toBe('Pipelining');
    expect(headings.get(1)).toBeNull(); // detected headings are not mixed in when bookmarks exist
    expect(deps.send).not.toHaveBeenCalled();
    expect(callClaude).not.toHaveBeenCalled();
  }, 60_000);

  it('outlines a slides PDF read the Phase 9 way once it is finished (CS 246, AI off)', async () => {
    const bytes = await makeBook(8);
    const store = new MemoryFileStore(COURSES);
    store.addFile(book('slides', CS246, bytes.length, { kind: 'upload', meta: { purpose: 'library' } }), bytes);
    const { ai, deps } = spyAi();
    const { result } = await runToEnd(store, ai, 'slides');
    expect(result.file.rows.filter((r) => r.status === 'done')).toHaveLength(6);
    const meta = store.docs.get('slides')!.meta;
    expect(meta.outline_source).toBe('headings');
    expect(meta.outline).toEqual([{ title: '1 Computer Abstractions and Technology', page: 1, level: 1 }]);
    expect([...store.rows.values()].find((r) => r.page === 1)!.headings).toBe('1 Computer Abstractions and Technology');
    expect(deps.send).not.toHaveBeenCalled();
    expect(deps.log).not.toHaveBeenCalled();
    expect(callClaude).not.toHaveBeenCalled();
    expect(transcribePages).not.toHaveBeenCalled();
  }, 60_000);

  it('an AI-on book leaves scanned pages for Extract pages instead of skipping them', async () => {
    const bytes = await makeBook(6);
    const store = new MemoryFileStore(COURSES);
    store.addFile(book('stat-book', STAT, bytes.length), bytes);
    const { ai, deps } = spyAi();
    const { result } = await runToEnd(store, ai, 'stat-book');
    const plates = result.file.rows.filter((r) => BLANK.has(r.page));
    expect(plates.every((r) => r.status === 'not_requested' && r.reason?.startsWith('No text layer'))).toBe(true);
    expect(result.file.summary).toBe('6 pages: 4 read from the PDF text, 2 not read yet.');
    // Indexing a book never sends anything, even when the course allows AI.
    expect(deps.send).not.toHaveBeenCalled();
    expect(transcribePages).not.toHaveBeenCalled();
  }, 60_000);
});

describe('heading detection', () => {
  const piece = (str: string, size: number, y: number): TextPiece => ({ str, size, y, hasEOL: true });

  it('finds numbered and chapter headings set larger than the body text', () => {
    const pieces = [
      piece('4 The Processor', 20, 700),
      piece('4.2 Logic Design Conventions', 14, 650),
      piece('Chapter 5 Memory', 18, 600),
      ...Array.from({ length: 10 }, (_, i) => piece('Body text in the normal size for this page.', 11, 580 - i * 14)),
    ];
    expect(bodySize(pieces)).toBe(11);
    expect(detectHeadings(pieces, 7)).toEqual([
      { title: '4 The Processor', page: 7, level: 1 },
      { title: '4.2 Logic Design Conventions', page: 7, level: 2 },
      { title: 'Chapter 5 Memory', page: 7, level: 1 },
    ]);
  });

  it('skips body-size numbered lines, contents lines, bare numbers, and long lines', () => {
    const pieces = [
      piece('3 Items numbered in body text', 11, 700),
      piece('4.2 Logic Design .......... 237', 14, 680),
      piece('4.2 Logic Design 237', 14, 660),
      piece('12', 20, 640),
      piece(`4 ${'A very long line '.repeat(8)}`, 16, 620),
      ...Array.from({ length: 10 }, (_, i) => piece('Body text in the normal size for this page.', 11, 580 - i * 14)),
    ];
    expect(detectHeadings(pieces, 1)).toEqual([]);
  });

  it('keeps the first appearance of a heading and rebuilds levels from stored rows', () => {
    expect(mergeHeadings([{ title: '4 The Processor', page: 9, level: 1 }, { title: '4  the processor', page: 30, level: 1 }])).toEqual([{ title: '4 The Processor', page: 9, level: 1 }]);
    expect(outlineFromPages([{ page: 3, headings: '4 The Processor\n4.1 Introduction' }, { page: 1, headings: null }])).toEqual([
      { title: '4 The Processor', page: 3, level: 1 },
      { title: '4.1 Introduction', page: 3, level: 2 },
    ]);
  });
});
