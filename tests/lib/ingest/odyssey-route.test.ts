import { beforeEach, describe, expect, it, vi } from 'vitest';

// POST /api/ingest/odyssey with the token store and the ingest helper in memory.

const TOKEN = 'b'.repeat(43);

const state = vi.hoisted(() => ({
  ingested: [] as { text: string; rows: number; pageUrl: string | null }[],
  duplicate: false,
  afterCalls: 0,
}));

vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ after: () => state.afterCalls++ }));
vi.mock('@/lib/db/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/jobs/schedule', () => ({ runQueuedJobs: async () => {} }));
vi.mock('@/lib/jobs/odyssey', () => ({
  ownerOfOdysseyToken: async (_admin: unknown, token: string) => (token === TOKEN ? { rowId: 't1', userId: 'u1', meta: {} } : null),
  ingestOdysseyRows: async (_admin: unknown, _owner: unknown, input: { text: string; rows: number; pageUrl: string | null }) => {
    state.ingested.push(input);
    return state.duplicate ? { status: 'duplicate', documentId: 'd0' } : { status: 'stored', documentId: 'd1' };
  },
}));

const { POST } = await import('@/app/api/ingest/odyssey/route');

const TABLE = [
  ['Course', 'Type', 'Date', 'Time', 'Location', 'Seat'],
  ['CS 251', 'Midterm', 'Thursday, November 12, 2026', '4:30 PM - 6:20 PM', 'PAC 7', '112'],
];

function post(body: unknown, token: string | null = TOKEN) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return POST(
    new Request('https://runway.test/api/ingest/odyssey', {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  state.ingested = [];
  state.duplicate = false;
  state.afterCalls = 0;
});

describe('POST /api/ingest/odyssey', () => {
  it('refuses a missing or unknown token before reading the body', async () => {
    for (const token of [null, 'wrong', 'c'.repeat(43)]) {
      const res = await post({ tables: [TABLE] }, token);
      expect(res.status).toBe(401);
      expect((await res.json()).message).toMatch(/token was refused/);
    }
    expect(state.ingested).toHaveLength(0);
  });

  it('refuses bad JSON and bad shapes', async () => {
    expect((await post('{nope')).status).toBe(400);
    expect((await post({ tables: 'CS 251' })).status).toBe(400);
    expect(state.ingested).toHaveLength(0);
  });

  it('stores nothing when no exam row parses', async () => {
    const res = await post({ tables: [[['Your exams'], ['No exams scheduled']]] });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ rows: 0, message: 'no exam rows on this page yet. Nothing was sent.' });
    expect(state.ingested).toHaveLength(0);
  });

  it('stores the rows as tab-separated text and starts the worker', async () => {
    const res = await post({ tables: [TABLE], pageUrl: 'https://odyssey.uwaterloo.ca/teaching/schedule' });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({
      message: 'sent 1 exam row. Changes show up in the Runway inbox.',
      rows: 1,
      status: 'stored',
      documentId: 'd1',
    });
    expect(state.ingested).toEqual([
      {
        text: 'Course\tType\tDate\tTime\tLocation\tSeat\nCS 251\tMidterm\tThursday, November 12, 2026\t4:30 PM - 6:20 PM\tPAC 7\t112',
        rows: 1,
        pageUrl: 'https://odyssey.uwaterloo.ca/teaching/schedule',
      },
    ]);
    expect(state.afterCalls).toBe(1);
  });

  it('answers 200 without starting the worker when the same rows were already stored', async () => {
    state.duplicate = true;
    const res = await post({ tables: [TABLE] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'duplicate', message: 'already up to date (1 exam row).' });
    expect(state.afterCalls).toBe(0);
  });
});
