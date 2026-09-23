import { readFileSync } from 'node:fs';
import path from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { callClaude, type AiCallRow, type AiDeps, type ClaudeRequest } from '@/lib/ai/client';
import { processDocument, type Claude } from '@/lib/inbox/process';
import type { ItemCtx, UpdateItemPayload } from '@/lib/inbox/types';
import {
  courseForClass,
  emailBatchSchema,
  emailDocument,
  htmlToText,
  ingestEmailBatch,
  piazzaClassId,
  piazzaPostUrl,
  UNMAPPED_NOTE,
  type EmailDocumentRow,
} from '@/lib/sources/email';
import { COURSES, IDS, ITEMS, TERM, TODAY } from '../inbox/context';
import { batch, MemoryEmailStore, NIDS, PIAZZA_MAP } from './email-store';

const replies = (name: string) =>
  (JSON.parse(readFileSync(path.join(__dirname, '../../fixtures/ai', name), 'utf8')) as { message: Anthropic.Message }[]).map((r) => r.message);

function replay(messages: Anthropic.Message[]) {
  const queue = [...messages];
  const logged: AiCallRow[] = [];
  const deps: AiDeps = {
    send: vi.fn(async () => {
      const next = queue.shift();
      if (!next) throw new Error('No recorded response left');
      return next;
    }),
    log: async (row) => {
      logged.push(row);
    },
  };
  const claude = vi.fn((req: ClaudeRequest<unknown>) => callClaude(deps, req)) as unknown as Claude & ReturnType<typeof vi.fn>;
  return { deps, claude, logged };
}

const QUIZ2_ID = '00000000-0000-4000-8000-00000000a002';
const QUIZ2: ItemCtx = {
  id: QUIZ2_ID,
  course_id: IDS.stat230,
  kind: 'quiz',
  title: 'Quiz 2',
  // Fri Oct 30, 2026, local midnight (EDT), date only.
  due_at: '2026-10-30T04:00:00.000Z',
  starts_at: null,
  ends_at: null,
  all_day: true,
  time_known: false,
  location: null,
  seat: null,
  weight_percent: null,
  state: 'active',
};

const mapped = COURSES.map((c) => ({ id: c.id, slug: c.slug }));

function processInput(row: EmailDocumentRow & { id: string }) {
  return {
    userId: IDS.user,
    doc: { id: row.id, course_id: row.course_id, raw_text: row.raw_text, source_url: row.source_url },
    declaredKind: 'piazza_email' as const,
    email: { from: row.meta.from, subject: row.meta.subject, date: row.meta.date, classId: row.meta.class_id },
    courses: COURSES,
    items: [...ITEMS, QUIZ2],
    today: TODAY,
    term: TERM,
  };
}

describe('Piazza email parsing', () => {
  it('finds the class id and the post link in text or HTML, dropping tracking parameters', () => {
    const text = `Go to https://piazza.com/class/${NIDS.stat230}/post/57 to view.`;
    expect(piazzaClassId({ text, html: null })).toBe(NIDS.stat230);
    expect(piazzaPostUrl({ text, html: null })).toBe(`https://piazza.com/class/${NIDS.stat230}/post/57`);
    const html = `<a href="https://piazza.com/class/${NIDS.cs251}?cid=88&amp;utm_source=email">view</a>`;
    expect(piazzaClassId({ text: '', html })).toBe(NIDS.cs251);
    expect(piazzaPostUrl({ text: '', html })).toBe(`https://piazza.com/class/${NIDS.cs251}?cid=88`);
    expect(piazzaClassId({ text: 'no links here https://example.com/class/abcdefgh', html: null })).toBeNull();
    expect(piazzaPostUrl({ text: `https://piazza.com/class/${NIDS.cs251}`, html: null })).toBeNull();
  });

  it('turns an HTML-only body into readable text', () => {
    expect(htmlToText('<p>Quiz 2&nbsp;moved</p><p>See <b>@57</b></p><style>p{}</style>')).toBe('Quiz 2 moved\nSee @57');
  });

  it('maps a class to a course only through the Piazza mapping', () => {
    expect(courseForClass(NIDS.stat230, PIAZZA_MAP, mapped)?.id).toBe(IDS.stat230);
    expect(courseForClass(NIDS.unmapped, PIAZZA_MAP, mapped)).toBeNull();
    expect(courseForClass(null, PIAZZA_MAP, mapped)).toBeNull();
    expect(courseForClass(NIDS.stat230, { [NIDS.stat230]: 'cs136' }, mapped)).toBeNull();
  });

  it('stores the body as sent, with headers in meta', () => {
    const [msg] = batch().messages;
    const row = emailDocument(IDS.user, msg, { id: IDS.stat230, slug: 'stat230' });
    expect(row).toMatchObject({
      kind: 'piazza_email',
      course_id: IDS.stat230,
      title: 'Instr Note @57: Quiz 2 moved to Nov 6',
      source_ref: msg.id,
      source_url: `https://piazza.com/class/${NIDS.stat230}/post/57`,
      raw_text: msg.text,
      raw_html: msg.html,
      captured_at: '2026-10-02T14:05:00.000Z',
    });
    expect(row.meta).toMatchObject({ from: msg.from, class_id: NIDS.stat230, subject: msg.subject });
    expect(row.meta.status).toBeUndefined();
  });

  it('rejects a batch that is not from the Piazza bridge or has a bad message', () => {
    expect(emailBatchSchema.safeParse({ source: 'other', messages: [] }).success).toBe(false);
    expect(emailBatchSchema.safeParse({ source: 'piazza', messages: [{ id: 'x', date: 'yesterday' }] }).success).toBe(false);
    expect(emailBatchSchema.safeParse({ source: 'piazza', messages: Array(51).fill({ id: 'x', date: '2026-10-02T14:05:00Z' }) }).success).toBe(false);
  });
});

describe('Email batch ingest', () => {
  it('stores one document per new message, and nothing the second time', async () => {
    const store = new MemoryEmailStore();
    const first = await ingestEmailBatch(store, IDS.user, batch(), PIAZZA_MAP, mapped);
    expect(first).toMatchObject({ received: 4, stored: 4, skipped: 0 });
    expect(first.toProcess).toHaveLength(3);
    expect(store.rows.map((r) => r.course_id)).toEqual([IDS.stat230, IDS.stat230, IDS.cs251, null]);
    const waiting = store.rows[3];
    expect(waiting.meta).toMatchObject({ status: 'stored_only', class_id: NIDS.unmapped, notes: [UNMAPPED_NOTE] });

    const again = await ingestEmailBatch(store, IDS.user, batch(), PIAZZA_MAP, mapped);
    expect(again).toEqual({ received: 4, stored: 0, skipped: 4, toProcess: [] });
    expect(store.rows).toHaveLength(4);
  });

  it('counts a message repeated inside one batch once', async () => {
    const store = new MemoryEmailStore();
    const b = batch();
    const res = await ingestEmailBatch(store, IDS.user, { ...b, messages: [b.messages[0], b.messages[0]] }, PIAZZA_MAP, mapped);
    expect(res).toMatchObject({ received: 2, stored: 1, skipped: 1 });
  });

  it('keeps two messages with the same body as two documents', async () => {
    const store = new MemoryEmailStore();
    const [m] = batch().messages;
    const res = await ingestEmailBatch(store, IDS.user, { source: 'piazza', messages: [m, { ...m, id: 'other-gmail-id' }] }, PIAZZA_MAP, mapped);
    expect(res.stored).toBe(2);
  });
});

describe('Piazza email extraction', () => {
  async function stored() {
    const store = new MemoryEmailStore();
    await ingestEmailBatch(store, IDS.user, batch(), PIAZZA_MAP, mapped);
    return store.rows;
  }

  it('proposes moving STAT 230 Quiz 2 to Nov 6, with the email headers in the source tag', async () => {
    const [quiz] = await stored();
    const { claude, logged } = replay(replies('stat230-piazza-quiz2.response.json'));
    const res = await processDocument(processInput(quiz), claude);
    expect(claude).toHaveBeenCalledTimes(1);
    expect(logged.map((l) => l.purpose)).toEqual(['extract_piazza']);
    const req = claude.mock.calls[0][0] as ClaudeRequest<unknown>;
    expect(req.user).toContain('<source kind="piazza_email" course_hint="stat230"');
    expect(req.user).toContain(`class_id="${NIDS.stat230}"`);
    expect(req.user).toContain('subject="Instr Note @57: Quiz 2 moved to Nov 6"');
    expect(res).toMatchObject({ status: 'extracted', kind: 'piazza_email', importance: 'deadline_change', usedAi: true });
    expect(res.summary).toMatch(/Quiz 2 moves/);
    expect(res.proposals).toHaveLength(1);
    const [p] = res.proposals;
    expect(p).toMatchObject({ kind: 'update_item', target_item_id: QUIZ2_ID, course_id: IDS.stat230 });
    const payload = p.payload as UpdateItemPayload;
    expect(payload.source).toBe('piazza_email');
    expect(payload.changes).toMatchObject({ due_at: '2026-11-06T05:00:00.000Z', time_known: false });
    expect(payload.before).toMatchObject({ due_at: '2026-10-30T04:00:00.000Z' });
  });

  it('marks a student question as noise with no proposals', async () => {
    const [, question] = await stored();
    const { claude } = replay(replies('stat230-piazza-noise.response.json'));
    const res = await processDocument(processInput(question), claude);
    expect(res).toMatchObject({ status: 'extracted', importance: 'noise', proposals: [] });
    expect(res.postUrl).toBe(`https://piazza.com/class/${NIDS.stat230}?cid=61`);
  });

  it('stores a CS 251 email and an unmapped one without calling Claude', async () => {
    const [, , cs251, waiting] = await stored();
    for (const row of [cs251, waiting]) {
      const { claude, deps } = replay(replies('stat230-piazza-quiz2.response.json'));
      const res = await processDocument(processInput(row), claude);
      expect(res).toMatchObject({ status: 'stored_only', kind: 'piazza_email', proposals: [], usedAi: false });
      expect(claude).not.toHaveBeenCalled();
      expect(deps.send).not.toHaveBeenCalled();
    }
  });
});
