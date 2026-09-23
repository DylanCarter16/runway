import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signBody } from '@/lib/ingest/verify';
import { ingestEmailBatch, type EmailBatch } from '@/lib/sources/email';
import { COURSES, IDS } from '../inbox/context';
import { batchText, MemoryEmailStore, PIAZZA_MAP } from './email-store';

// POST /api/ingest/email end to end, with the database swapped for memory.

const SECRET = 'test-ingest-secret-not-real';
const state = vi.hoisted(() => ({ store: null as unknown, queued: [] as string[], contacts: [] as unknown[], afters: 0 }));

vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({ serverEnv: { INGEST_WEBHOOK_SECRET: 'test-ingest-secret-not-real' } }));
vi.mock('next/server', () => ({ after: () => void state.afters++ }));
vi.mock('@/lib/db/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/jobs/schedule', () => ({ runQueuedJobs: async () => {} }));
vi.mock('@/lib/digest/load', () => ({
  ownerUserId: async () => '00000000-0000-4000-8000-00000000e001',
  recordBridgeContact: async (_a: unknown, _u: string, stats: unknown) => void state.contacts.push(stats),
}));
vi.mock('@/lib/jobs/email', () => ({
  ingestEmails: async (_admin: unknown, userId: string, batch: EmailBatch) => {
    const res = await ingestEmailBatch(
      state.store as MemoryEmailStore,
      userId,
      batch,
      PIAZZA_MAP,
      COURSES.map((c) => ({ id: c.id, slug: c.slug })),
    );
    state.queued.push(...res.toProcess);
    return res;
  },
}));

const { POST } = await import('@/app/api/ingest/email/route');

function signed(body: string, opts: { ageSeconds?: number; secret?: string } = {}) {
  const ts = String(Math.floor(Date.now() / 1000) - (opts.ageSeconds ?? 0));
  return new Request('https://runway.test/api/ingest/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-runway-timestamp': ts, 'x-runway-signature': signBody(opts.secret ?? SECRET, ts, body) },
    body,
  });
}

describe('POST /api/ingest/email', () => {
  beforeEach(() => {
    state.store = new MemoryEmailStore();
    state.queued = [];
    state.contacts = [];
    state.afters = 0;
  });

  it('stores a signed batch once, queues the mapped emails, and stores nothing on resend', async () => {
    const body = batchText();
    const res = await POST(signed(body));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: 4, stored: 4, skipped: 0 });
    const store = state.store as MemoryEmailStore;
    expect(store.rows.map((r) => r.user_id)).toEqual(Array(4).fill(IDS.user));
    expect(state.queued).toHaveLength(3);
    expect(state.afters).toBe(1);

    const again = await POST(signed(body));
    expect(await again.json()).toEqual({ accepted: 4, stored: 0, skipped: 4 });
    expect(store.rows).toHaveLength(4);
    expect(state.queued).toHaveLength(3);
    expect(state.afters).toBe(1);
    expect(state.contacts).toEqual([
      { kind: 'email', messages: 4, stored: 4, skipped: 0 },
      { kind: 'email', messages: 4, stored: 0, skipped: 4 },
    ]);
  });

  it('answers 401 to a bad signature or a timestamp older than 5 minutes, and stores nothing', async () => {
    const body = batchText();
    for (const req of [signed(body, { secret: 'wrong' }), signed(body, { ageSeconds: 301 }), new Request('https://runway.test/api/ingest/email', { method: 'POST', body })]) {
      const res = await POST(req);
      expect(res.status).toBe(401);
    }
    expect((state.store as MemoryEmailStore).rows).toHaveLength(0);
    expect(state.contacts).toHaveLength(0);
  });

  it('answers 400 to a signed body that is not a Piazza batch', async () => {
    expect((await POST(signed('not json'))).status).toBe(400);
    expect((await POST(signed(JSON.stringify({ source: 'piazza', messages: [{ id: 'x' }] })))).status).toBe(400);
    expect((state.store as MemoryEmailStore).rows).toHaveLength(0);
  });
});
