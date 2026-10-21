import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';
import type { FileAi, FileDoc } from '@/lib/files/process';
import { StorageReadLimitError } from '@/lib/files/storage-reads';
import type { Job } from '@/lib/jobs/queue';
import { MemoryFileStore } from '../files/memory-store';

// Storage egress regression (2026-10-20): the job worker must not download a file over and
// over. A file that can't be read or saved used to loop for good: the last try marked "the
// first waiting page" failed (there was none, nothing was planned yet) and queued the next
// step, which downloaded the whole file again, three times, then queued the next one.

vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({ serverEnv: {}, clientEnv: {} }));
vi.mock('@/lib/db/admin', () => ({ createAdminClient: () => ({}) }));
vi.setConfig({ testTimeout: 60_000 });

const { fileJob, makeFileHandler } = await import('@/lib/jobs/files');
const { fileStep } = await import('@/lib/files/process');

const USER = 'u1';
const COURSES = [
  { id: 'stat', code: 'STAT 230', title: 'Probability', ai_allowed: true },
  { id: 'cs251', code: 'CS 251', title: 'Computer Organization and Design', ai_allowed: false },
];
const NOTEBOOK = new Uint8Array(readFileSync(path.join(__dirname, '../../fixtures/files/stat230-notebook-scanned.pdf')));

function doc(id: string, over: Partial<FileDoc> = {}): FileDoc {
  return {
    id,
    user_id: USER,
    course_id: 'cs251',
    kind: 'upload',
    title: `${id}.pdf`,
    storage_path: `${USER}/${id}/${id}.pdf`,
    file_name: `${id}.pdf`,
    file_type: 'application/pdf',
    file_size: 1,
    meta: { purpose: 'library', status: 'queued' },
    ...over,
  };
}

async function textPdf(pages: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= pages; n++) pdf.addPage([612, 792]).drawText(`Page ${n}: datapaths, registers, and memory.`, { x: 72, y: 700, size: 12, font });
  return pdf.save();
}

const noAi: FileAi = { deps: null, unavailableReason: 'Claude is not set up yet.' };

/** The jobs table and processJobs in miniature: claim, run, retry until max_attempts, follow queued steps. */
async function drain(store: MemoryFileStore, documentId: string, maxRuns = 60) {
  const queue: Job[] = [];
  let id = 0;
  const admin = {
    from: () => ({
      insert: async (row: Partial<Job>) => {
        queue.push({ ...row, id: `job-${++id}`, attempts: 0, status: 'pending' } as Job);
        return { error: null };
      },
    }),
  };
  const handler = makeFileHandler({ store: () => store, ai: async () => noAi });
  const first = fileJob(USER, documentId, 0);
  queue.push({ id: 'job-0', user_id: USER, type: first.type, payload: first.payload, max_attempts: first.maxAttempts, attempts: 0, status: 'pending' } as unknown as Job);
  let runs = 0;
  let retries = 0;
  while (queue.length && runs < maxRuns) {
    const job = queue.shift()!;
    job.attempts++;
    runs++;
    try {
      await handler(admin as never, job);
    } catch {
      if (job.attempts < job.max_attempts) {
        retries++;
        queue.push(job);
      }
    }
  }
  return { runs, retries, left: queue.length };
}

describe('the job worker downloads a file a bounded number of times', () => {
  it('pages that can never be saved: three tries, three downloads, then the file is failed (it used to loop for good)', async () => {
    const store = new MemoryFileStore(COURSES);
    store.addFile(doc('nul'), await textPdf(5));
    // Like Postgres refusing a NUL in page text, on every try.
    store.savePages = async () => {
      throw new Error('Could not save the pages: unsupported Unicode escape sequence');
    };

    const r = await drain(store, 'nul');

    expect(r.left).toBe(0);
    expect(r.runs).toBe(3);
    expect(store.downloads).toBe(3);
    const meta = store.docs.get('nul')!.meta;
    expect(meta.status).toBe('failed');
    expect(meta.summary).toContain('unsupported Unicode escape sequence');
  });

  it('a file that is not a PDF at all: three tries, then failed', async () => {
    const store = new MemoryFileStore(COURSES);
    store.addFile(doc('junk'), new TextEncoder().encode('not a pdf, just text'));
    const r = await drain(store, 'junk');
    expect(r.left).toBe(0);
    expect(store.downloads).toBe(3);
    expect(store.docs.get('junk')!.meta.status).toBe('failed');
  });

  it('a book that will not open stops instead of walking its pages', async () => {
    const store = new MemoryFileStore(COURSES);
    store.addFile(doc('book', { kind: 'textbook', meta: { purpose: 'textbook', page_count: 600, index: { next: 1, total: 600 } } }), new TextEncoder().encode('%PDF-1.7 broken'));
    const r = await drain(store, 'book');
    expect(r.left).toBe(0);
    expect(store.downloads).toBe(3); // not 600 pages x 3 tries
    expect(store.rows.size).toBe(0);
    expect(store.docs.get('book')!.meta.status).toBe('failed');
  });

  it('past the daily read cap: no retry and no download, the file is failed with the reason', async () => {
    const store = new MemoryFileStore(COURSES);
    store.addFile(doc('capped'), await textPdf(2));
    const download = store.download.bind(store);
    store.download = async () => {
      throw new StorageReadLimitError('worker', 101);
    };
    const r = await drain(store, 'capped');
    expect(r).toEqual({ runs: 1, retries: 0, left: 0 });
    expect(store.downloads).toBe(0);
    expect(store.docs.get('capped')!.meta.status).toBe('failed');
    expect(store.docs.get('capped')!.meta.summary).toContain('Settings, Data');
    store.download = download;
  });
});

describe('one download per step', () => {
  async function stepsAndDownloads(store: MemoryFileStore, id: string, ai: FileAi) {
    let steps = 0;
    for (; steps < 40; steps++) if ((await fileStep(store, ai, id, USER)).state === 'finished') break;
    return { steps: steps + 1, downloads: store.downloads };
  }

  it('a text PDF is read and outlined in one step from one download (it was two)', async () => {
    const store = new MemoryFileStore(COURSES);
    store.addFile(doc('slides'), await textPdf(30));
    expect(await stepsAndDownloads(store, 'slides', noAi)).toEqual({ steps: 1, downloads: 1 });
    expect(store.docs.get('slides')!.meta.outline_source).toBeDefined();
  });

  it('a scan whose pages Claude reads three at a time downloads once per step', async () => {
    const store = new MemoryFileStore(COURSES);
    store.addFile(doc('scan', { course_id: 'stat' }), NOTEBOOK);
    const pages = (await PDFDocument.load(NOTEBOOK)).getPageCount();
    const deps = {
      send: vi.fn(async (params: { messages: { content: { type: string; text?: string }[] }[] }) => {
        const turn = params.messages[0].content.find((b) => b.type === 'text')!.text!;
        const asked = /Return exactly these page numbers: ([\d, ]+)\./.exec(turn)![1].split(', ').map(Number);
        return {
          id: 'msg',
          type: 'message',
          role: 'assistant',
          model: 'claude',
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
          content: [{ type: 'text', text: JSON.stringify({ pages: asked.map((p) => ({ page: p, markdown: `Page ${p}`, blank: false })) }), citations: null }],
        };
      }),
      log: async () => undefined,
    };
    const r = await stepsAndDownloads(store, 'scan', { deps: deps as never, unavailableReason: null });
    expect(deps.send).toHaveBeenCalledTimes(Math.ceil(pages / 3));
    expect(r.downloads).toBe(r.steps);
  });
});
