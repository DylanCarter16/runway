import { readFileSync } from 'node:fs';
import path from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';
import type { AiDeps } from '@/lib/ai/client';
import { MAX_VISION_IMAGE_BYTES } from '@/lib/files/constants';
import { readPdf, slicePdf } from '@/lib/files/pdf';
import { describePages, stitchPages } from '@/lib/files/plan';
import { processFileStep, type FileAi, type FileDoc, type StepResult } from '@/lib/files/process';
import { MemoryFileStore } from './memory-store';

// Real PDF work: under a full parallel run these can pass vitest's 5-second default.
vi.setConfig({ testTimeout: 30_000 });

const FIXTURES = path.join(__dirname, '../../fixtures');
const NOTEBOOK = new Uint8Array(readFileSync(path.join(FIXTURES, 'files/stat230-notebook-scanned.pdf')));
const SPEC = JSON.parse(readFileSync(path.join(FIXTURES, 'files/stat230-notebook.json'), 'utf8')) as { pages: { heading: string; lines: string[] }[] };
const RECORDED = (JSON.parse(readFileSync(path.join(FIXTURES, 'ai/stat230-notebook-transcribe.response.json'), 'utf8')) as { message: Anthropic.Message }[]).map((r) => r.message);

const USER = 'u1';
const STAT = 'course-stat230';
const CS251 = 'course-cs251';
const COURSES = [
  { id: STAT, code: 'STAT 230', title: 'Probability', ai_allowed: true },
  { id: CS251, code: 'CS 251', title: 'Computer Organization and Design', ai_allowed: false },
];

function doc(id: string, over: Partial<FileDoc> = {}): FileDoc {
  return {
    id,
    user_id: USER,
    course_id: STAT,
    kind: 'upload',
    title: `${id}.pdf`,
    storage_path: `${USER}/${id}/${id}.pdf`,
    file_name: `${id}.pdf`,
    file_type: 'application/pdf',
    file_size: NOTEBOOK.length,
    meta: { purpose: 'library' },
    ...over,
  };
}

/** Replays the recorded answers in order, and keeps every request for inspection. */
function replay(messages: Anthropic.Message[]) {
  const queue = [...messages];
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const deps: AiDeps = {
    send: vi.fn(async (params) => {
      requests.push(params);
      const next = queue.shift();
      if (!next) throw new Error('No recorded answer left.');
      return next;
    }),
    log: async () => undefined,
  };
  return { deps, requests };
}

/** Recorded page text, served for whichever pages a request asks for (the page numbers in its text turn). */
function byPage() {
  const bank = new Map<number, string>();
  for (const m of RECORDED) {
    const text = m.content.find((b): b is Anthropic.TextBlock => b.type === 'text')!.text;
    for (const p of (JSON.parse(text) as { pages: { page: number; markdown: string }[] }).pages) bank.set(p.page, p.markdown);
  }
  const requests: number[][] = [];
  const deps: AiDeps = {
    send: vi.fn(async (params) => {
      const content = params.messages[0].content as Anthropic.ContentBlockParam[];
      const turn = content.find((b): b is Anthropic.TextBlockParam => b.type === 'text')!.text;
      const asked = /Return exactly these page numbers: ([\d, ]+)\./.exec(turn)![1].split(', ').map(Number);
      requests.push(asked);
      // Like a real answer that drops the last page of a group: only the first page when asked for 6 and 7.
      const answer = asked.length > 1 && asked.includes(7) ? asked.filter((p) => p !== 7) : asked;
      return { ...RECORDED[0], content: [{ type: 'text', text: JSON.stringify({ pages: answer.map((p) => ({ page: p, markdown: bank.get(p)!, blank: false })) }), citations: null }] } as Anthropic.Message;
    }),
    log: async () => undefined,
  };
  return { deps, requests };
}

async function runToEnd(store: MemoryFileStore, ai: FileAi, id: string): Promise<Extract<StepResult, { state: 'finished' }>> {
  for (let step = 0; step < 30; step++) {
    const r = await processFileStep(store, ai, id, USER);
    if (r.state === 'finished') return r;
    if (r.state === 'missing') throw new Error('missing');
  }
  throw new Error('did not finish in 30 steps');
}

async function textPdf(pages: string[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const text of pages) pdf.addPage([612, 792]).drawText(text, { x: 72, y: 700, size: 12, font });
  return pdf.save();
}

describe('scanned GoodNotes-style notebook (STAT 230, AI on)', () => {
  it('comes through whole: every page transcribed, stitched in page order, three calls of at most three pages', async () => {
    const store = new MemoryFileStore(COURSES);
    store.addFile(doc('notebook'), NOTEBOOK);
    const { deps, requests } = replay(RECORDED);

    const r = await runToEnd(store, { deps, unavailableReason: null }, 'notebook');

    expect(r.file.rows).toHaveLength(7);
    expect(r.file.rows.every((p) => p.status === 'done' && p.method === 'vision')).toBe(true);
    expect(r.file.summary).toBe('7 pages: 7 transcribed by Claude.');

    // Stitched in order: page headings 1 to 7, each followed by that page's own heading.
    const pageHeads = [...r.file.allText.matchAll(/^## Page (\d+)$/gm)].map((m) => Number(m[1]));
    expect(pageHeads).toEqual([1, 2, 3, 4, 5, 6, 7]);
    let from = 0;
    for (const [i, p] of SPEC.pages.entries()) {
      const at = r.file.allText.indexOf(`# ${p.heading}`, from);
      expect(at, `page ${i + 1}: ${p.heading}`).toBeGreaterThan(from - 1);
      from = at;
    }
    // Nothing cut: the last line of the last page is there.
    expect(r.file.allText).toContain('Quiz 2 Fri Oct 30 in tutorial (UTD 105)');
    expect(r.file.allText).toContain('[Diagram: Venn diagram');

    // Three requests; each sends exactly its pages as a PDF, and names them.
    expect(requests).toHaveLength(3);
    const sent: number[] = [];
    for (const [i, req] of requests.entries()) {
      const content = req.messages[0].content as Anthropic.ContentBlockParam[];
      const pdf = content[0] as Anthropic.DocumentBlockParam;
      expect(pdf.type).toBe('document');
      const bytes = Buffer.from((pdf.source as Anthropic.Base64PDFSource).data, 'base64');
      const count = (await PDFDocument.load(bytes)).getPageCount();
      expect(count).toBe([3, 3, 1][i]);
      sent.push(count);
      expect((content[1] as Anthropic.TextBlockParam).text).toContain(`Return exactly these page numbers: ${[[1, 2, 3], [4, 5, 6], [7]][i].join(', ')}.`);
    }
    expect(sent.reduce((a, b) => a + b)).toBe(7);
  });

  it('a later export of the same notebook reads only its new pages', async () => {
    const store = new MemoryFileStore(COURSES);
    // Week 1: the first five pages.
    store.addFile(doc('week1'), await slicePdf(NOTEBOOK, [1, 2, 3, 4, 5]));
    const first = byPage();
    const w1 = await runToEnd(store, { deps: first.deps, unavailableReason: null }, 'week1');
    expect(w1.file.summary).toBe('5 pages: 5 transcribed by Claude.');
    expect(first.requests).toEqual([[1, 2, 3], [4, 5]]);

    // Week 2: the whole notebook, re-exported. Pages 1 to 5 are skipped; 6 and 7 are read.
    store.addFile(doc('week2'), NOTEBOOK);
    const second = byPage();
    const w2 = await runToEnd(store, { deps: second.deps, unavailableReason: null }, 'week2');
    // Asked for 6 and 7 together; the answer left out 7, so 7 went again on its own.
    expect(second.requests).toEqual([[6, 7], [7]]);
    expect(w2.file.summary).toBe('7 pages: 2 transcribed by Claude, 5 already stored (pages 1–5).');
    expect(w2.file.newText).toMatch(/^## Page 6\n\n# Lecture 11/);
    expect(w2.file.newText).toContain('## Page 7');
    expect(w2.file.newText).not.toContain('## Page 5');
    // The whole-file text still has every page, from the earlier upload.
    expect([...w2.file.allText.matchAll(/^## Page (\d+)$/gm)].map((m) => Number(m[1]))).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('the same file uploaded again sends nothing', async () => {
    const store = new MemoryFileStore(COURSES);
    store.addFile(doc('a'), NOTEBOOK);
    await runToEnd(store, { deps: replay(RECORDED).deps, unavailableReason: null }, 'a');
    store.addFile(doc('b'), NOTEBOOK);
    const again = replay([]);
    const r = await runToEnd(store, { deps: again.deps, unavailableReason: null }, 'b');
    expect(again.deps.send).not.toHaveBeenCalled();
    expect(r.file.newText).toBe('');
    expect(r.file.summary).toBe('7 pages: 7 already stored (pages 1–7).');
  });
});

describe('AI-off courses never send a file to Claude', () => {
  it('a scanned PDF for CS 251 is stored, and every page says why it was not read', async () => {
    const store = new MemoryFileStore(COURSES);
    store.addFile(doc('cs251-notes', { course_id: CS251 }), NOTEBOOK);
    const { deps } = replay(RECORDED);
    const r = await runToEnd(store, { deps, unavailableReason: null }, 'cs251-notes');
    expect(deps.send).not.toHaveBeenCalled();
    expect(r.file.rows.every((p) => p.status === 'skipped')).toBe(true);
    expect(r.file.summary).toBe("7 pages. Skipped pages 1–7: CS 251 doesn't allow AI, so this page is stored but not transcribed.");
    expect(store.files.get(`${USER}/cs251-notes/cs251-notes.pdf`)).toEqual(NOTEBOOK);
  });

  it('a photo for CS 251 is not sent', async () => {
    const store = new MemoryFileStore(COURSES);
    store.addFile(doc('board', { course_id: CS251, file_type: 'image/jpeg', file_name: 'board.jpg', storage_path: `${USER}/board/board.jpg` }), new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]));
    const { deps } = replay(RECORDED);
    const r = await runToEnd(store, { deps, unavailableReason: null }, 'board');
    expect(deps.send).not.toHaveBeenCalled();
    expect(r.file.rows[0]).toMatchObject({ status: 'skipped' });
  });

  it('a file with no course is not sent', async () => {
    const store = new MemoryFileStore(COURSES);
    store.addFile(doc('loose', { course_id: null }), NOTEBOOK);
    const { deps } = replay(RECORDED);
    const r = await runToEnd(store, { deps, unavailableReason: null }, 'loose');
    expect(deps.send).not.toHaveBeenCalled();
    expect(r.file.rows[0].reason).toMatch(/No course is picked/);
  });

  it('an extract request on a CS 251 textbook reads the text layer and sends nothing', async () => {
    const store = new MemoryFileStore(COURSES);
    const book = await textPdf(['Chapter 1: bits and bytes. Two to the tenth is 1024.', 'Chapter 2: logic gates and truth tables for AND and OR.', 'Chapter 3']);
    store.addFile(doc('book', { course_id: CS251, kind: 'textbook' }), book);
    const { deps } = replay(RECORDED);
    const listed = await runToEnd(store, { deps, unavailableReason: null }, 'book');
    expect(listed.file.summary).toBe('3 pages: 3 not read yet.');

    store.docs.get('book')!.meta.extract = { from: 1, to: 2 };
    const r = await runToEnd(store, { deps, unavailableReason: null }, 'book');
    expect(deps.send).not.toHaveBeenCalled();
    expect(r.file.summary).toBe('3 pages: 2 read from the PDF text, 1 not read yet.');
    expect(r.file.newText).toContain('Chapter 2: logic gates');
  });

  it('turning AI off after a file was planned stops the rest from being sent', async () => {
    const courses = COURSES.map((c) => ({ ...c }));
    const store = new MemoryFileStore(courses);
    store.addFile(doc('switch'), NOTEBOOK);
    const { deps } = replay(RECORDED);
    const first = await processFileStep(store, { deps, unavailableReason: null }, 'switch', USER);
    expect(first.state).toBe('more');
    expect(deps.send).toHaveBeenCalledTimes(1);

    courses[0].ai_allowed = false;
    const r = await runToEnd(store, { deps, unavailableReason: null }, 'switch');
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(r.file.summary).toBe("7 pages: 3 transcribed by Claude. Skipped pages 4–7: STAT 230 doesn't allow AI, so this page is stored but not transcribed.");
  });
});

describe('other files', () => {
  it('a text PDF (slides, handouts) is read from its own text, with no Claude call', async () => {
    const store = new MemoryFileStore(COURSES);
    store.addFile(doc('slides'), await textPdf(['Slide 1: the binomial distribution counts successes.', 'Slide 2: the hypergeometric distribution draws without replacement.']));
    const { deps } = replay([]);
    const r = await runToEnd(store, { deps, unavailableReason: null }, 'slides');
    expect(deps.send).not.toHaveBeenCalled();
    expect(r.file.summary).toBe('2 pages: 2 read from the PDF text.');
    expect(r.file.allText).toMatch(/## Page 1\n\nSlide 1: the binomial[\s\S]*## Page 2\n\nSlide 2/);
  });

  it('a HEIC photo is stored and says to export it as JPEG', async () => {
    const store = new MemoryFileStore(COURSES);
    store.addFile(doc('heic', { file_type: 'image/heic', file_name: 'IMG_1.HEIC', storage_path: `${USER}/heic/IMG_1.HEIC` }), new Uint8Array([1, 2, 3]));
    const { deps } = replay([]);
    const r = await runToEnd(store, { deps, unavailableReason: null }, 'heic');
    expect(deps.send).not.toHaveBeenCalled();
    expect(r.file.summary).toMatch(/Skipped page 1: Claude can't read this image type/);
  });

  it('an image over 5 MB is stored and skipped, saying so', async () => {
    const store = new MemoryFileStore(COURSES);
    store.addFile(doc('big', { file_type: 'image/png', file_name: 'big.png', storage_path: `${USER}/big/big.png` }), new Uint8Array(MAX_VISION_IMAGE_BYTES + 1));
    const { deps } = replay([]);
    const r = await runToEnd(store, { deps, unavailableReason: null }, 'big');
    expect(deps.send).not.toHaveBeenCalled();
    expect(r.file.summary).toMatch(/over 5 MB/);
  });

  it('without a working key the pages fail with the reason, and the file still finishes', async () => {
    const store = new MemoryFileStore(COURSES);
    store.addFile(doc('nokey'), NOTEBOOK);
    const r = await runToEnd(store, { deps: null, unavailableReason: 'Claude is not set up yet (no API key).' }, 'nokey');
    expect(r.file.rows.every((p) => p.status === 'failed')).toBe(true);
    expect(r.file.summary).toMatch(/Skipped pages 1–7: Claude is not set up yet/);
  });
});

describe('pdf helpers', () => {
  it('finds no text layer in the scanned fixture, and slices keep page fingerprints', async () => {
    const info = await readPdf(NOTEBOOK);
    expect(info.pageCount).toBe(7);
    expect(info.pages.every((p) => p.text === '')).toBe(true);
    expect(new Set(info.pages.map((p) => p.fingerprint)).size).toBe(7);
    const slice = await readPdf(await slicePdf(NOTEBOOK, [6, 7]));
    expect(slice.pages.map((p) => p.fingerprint)).toEqual([info.pages[5].fingerprint, info.pages[6].fingerprint]);
  });

  it('stitches only readable pages and describes skipped ones by range', () => {
    const rows = [
      { page: 2, status: 'done' as const, method: 'vision' as const, text: 'two', reason: null },
      { page: 1, status: 'done' as const, method: 'pdf_text' as const, text: 'one', reason: null },
      { page: 3, status: 'skipped' as const, method: null, text: null, reason: 'Too large.' },
      { page: 4, status: 'skipped' as const, method: null, text: null, reason: 'Too large.' },
    ];
    expect(stitchPages(rows, { includeStored: false })).toBe('## Page 1\n\none\n\n## Page 2\n\ntwo');
    expect(describePages(rows)).toBe('4 pages: 1 read from the PDF text, 1 transcribed by Claude. Skipped pages 3–4: Too large.');
  });
});
