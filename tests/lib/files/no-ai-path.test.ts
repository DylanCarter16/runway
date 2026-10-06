import { PDFDocument, StandardFonts } from 'pdf-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiDeps } from '@/lib/ai/client';
import { fileStep, type FileDoc } from '@/lib/files/process';
import { MemoryFileStore } from './memory-store';

// Phase 10, Task 3 acceptance: uploading, indexing, outlining, and searching a CS 251 and a
// CS 246 document never call Claude and never write an ai_calls row. The server actions run
// against a recording stand-in for Supabase; the reading runs through the real fileStep.

const callClaude = vi.hoisted(() => vi.fn());
const callClaudeText = vi.hoisted(() => vi.fn());
vi.mock('@/lib/ai/client', async (original) => ({ ...(await original<typeof import('@/lib/ai/client')>()), callClaude, callClaudeText }));
vi.mock('next/server', () => ({ after: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/jobs/files', () => ({ queueFile: vi.fn(async () => ({})) }));
vi.mock('@/lib/jobs/schedule', () => ({ runQueuedJobs: vi.fn() }));

const USER = '00000000-0000-4000-8000-000000000001';
const CS251 = '00000000-0000-4000-8000-000000000251';
const CS246 = '00000000-0000-4000-8000-000000000246';
const COURSES = [
  { id: CS251, code: 'CS 251', title: 'Computer Organization and Design', ai_allowed: false },
  { id: CS246, code: 'CS 246', title: 'Object-Oriented Software Development', ai_allowed: false },
];

/** Every table and function the actions touch, in order. */
const touched: string[] = [];
const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
let storedSize = 0;

/** A chainable stand-in for a Supabase query: records the table, resolves to an empty success. */
function query(table: string) {
  touched.push(table);
  const result = { data: null, error: null };
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'in', 'is', 'not', 'order', 'limit', 'gte', 'lt']) builder[m] = () => builder;
  builder.maybeSingle = async () => result;
  builder.single = async () => result;
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result);
  return builder;
}

const supabase = {
  from: (table: string) => query(table),
  rpc: async (name: string, args: Record<string, unknown>) => {
    touched.push(`rpc:${name}`);
    rpcCalls.push({ name, args });
    return {
      data: [{ document_id: 'doc', course_id: args.p_course_id ?? CS251, title: 'Book', page: 237, heading: '4 The Processor', snippet: 'the <mark>pipeline</mark> hazard', rank: 1 }],
      error: null,
    };
  },
  storage: {
    from: () => ({
      list: async (folder: string) => ({ data: [{ name: 'book.pdf', metadata: { size: storedSize } }], error: null, folder }),
    }),
  },
};

vi.mock('@/lib/db/server', () => ({
  createClient: async () => supabase,
  requireUser: async () => ({ id: USER }),
}));

async function textbookPdf(pages: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= pages; n++) {
    const page = pdf.addPage([612, 792]);
    if (n === 1) page.drawText('4 The Processor', { x: 72, y: 720, size: 20, font });
    page.drawText(`Page ${n}: the pipeline hazard and forwarding paths in the datapath.`, { x: 72, y: 680, size: 11, font });
  }
  return pdf.save();
}

beforeEach(() => {
  touched.length = 0;
  rpcCalls.length = 0;
  callClaude.mockClear();
  callClaudeText.mockClear();
});

describe.each([
  ['CS 251', CS251],
  ['CS 246', CS246],
])('%s documents never reach Claude', (code, courseId) => {
  it('upload, index, outline, and search', async () => {
    const { startUpload, finishUpload, searchPages } = await import('@/app/(app)/files/actions');
    const bytes = await textbookPdf(12);
    storedSize = bytes.length;
    const upload = { name: 'book.pdf', size: bytes.length, type: 'application/pdf' as const, sha256: 'a'.repeat(64), courseId, purpose: 'textbook' as const };

    // Upload: the two server actions the browser calls.
    const started = await startUpload(upload);
    expect(started.ok).toBe(true);
    const target = started.ok && started.data.status === 'upload' ? started.data : null;
    expect(target).not.toBeNull();
    const finished = await finishUpload({ ...upload, documentId: target!.documentId, path: target!.path });
    expect(finished).toMatchObject({ ok: true });

    // Index and outline: the job's steps, with AI deps that fail loudly if used.
    const store = new MemoryFileStore(COURSES);
    const doc: FileDoc = {
      id: target!.documentId,
      user_id: USER,
      course_id: courseId,
      kind: 'textbook',
      title: 'book.pdf',
      storage_path: target!.path,
      file_name: 'book.pdf',
      file_type: 'application/pdf',
      file_size: bytes.length,
      meta: { purpose: 'textbook' },
    };
    store.addFile(doc, bytes);
    const deps: AiDeps = { send: vi.fn(async () => { throw new Error(`${code} text must not reach Claude`); }), log: vi.fn(async () => undefined) };
    let state = 'more';
    for (let i = 0; i < 10 && state !== 'finished'; i++) state = (await fileStep(store, { deps, unavailableReason: null }, doc.id, USER)).state;
    expect(state).toBe('finished');
    expect([...store.rows.values()].every((r) => r.status === 'done' && r.method === 'pdf_text')).toBe(true);
    expect(store.docs.get(doc.id)!.meta.outline).toEqual([{ title: '4 The Processor', page: 1, level: 1 }]);

    // Search: inside the document and across the course.
    const inDoc = await searchPages({ q: 'pipeline hazard', documentId: doc.id });
    const inCourse = await searchPages({ q: 'pipeline hazard', courseId });
    expect(inDoc).toMatchObject({ ok: true, data: [{ page: 237, heading: '4 The Processor' }] });
    expect(inCourse.ok).toBe(true);
    expect(rpcCalls.map((c) => c.name)).toEqual(['search_pages', 'search_pages']);

    expect(callClaude).not.toHaveBeenCalled();
    expect(callClaudeText).not.toHaveBeenCalled();
    expect(deps.send).not.toHaveBeenCalled();
    expect(deps.log).not.toHaveBeenCalled();
    expect(touched).not.toContain('ai_calls');
    expect(touched.filter((t) => t.startsWith('rpc:'))).toEqual(['rpc:search_pages', 'rpc:search_pages']);
  }, 60_000);
});
