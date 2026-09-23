import ical from 'node-ical';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashFeedToken, newFeedToken } from '@/lib/ics/feed';
import { planItemEvents } from '@/lib/reminders/events';
import { fromTorontoLocal } from '@/lib/time';

// GET /api/feed/<token>.ics with integration_tokens and the event loader in memory.

interface Row {
  id: string;
  user_id: string;
  provider: string;
  meta: Record<string, unknown>;
}

const state = vi.hoisted(() => ({ rows: [] as Row[], updates: 0, loadedFor: [] as string[] }));

/** Just enough of the Supabase query builder for ownerOfFeedToken. */
function fakeAdmin() {
  return {
    from: () => ({
      select: () => {
        const filters: [string, string][] = [];
        const q = {
          eq(col: string, val: string) {
            filters.push([col, val]);
            return q;
          },
          async maybeSingle() {
            const match = state.rows.filter((r) =>
              filters.every(([c, v]) => (c === 'meta->>token_hash' ? r.meta.token_hash === v : (r as unknown as Record<string, unknown>)[c] === v)),
            );
            return { data: match[0] ?? null, error: null };
          },
        };
        return q;
      },
      update: (patch: { meta: Record<string, unknown> }) => ({
        eq: async (_col: string, id: string) => {
          state.updates++;
          const row = state.rows.find((r) => r.id === id);
          if (row) row.meta = patch.meta;
          return { error: null };
        },
      }),
    }),
  };
}

vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({ serverEnv: { APP_URL: 'https://runway.test' } }));
vi.mock('@/lib/db/admin', () => ({ createAdminClient: () => fakeAdmin() }));
vi.mock('@/lib/jobs/gcal', () => ({
  plannedCalendarEvents: async (_admin: unknown, userId: string) => {
    state.loadedFor.push(userId);
    return planItemEvents(
      {
        id: 'a1',
        kind: 'assignment',
        title: 'A1',
        courseCode: 'CS 251',
        courseSlug: 'cs251',
        due_at: fromTorontoLocal('2026-09-30', '22:00').toISOString(),
        starts_at: null,
        ends_at: null,
        all_day: false,
        time_known: true,
        location: null,
        seat: null,
        state: 'active',
        progress: 'todo',
        created_at: '2026-09-01T12:00:00Z',
        source_url: null,
        prep_days: null,
        reminder_minutes: null,
      },
      { appUrl: 'https://runway.test', studyBlockHour: 19 },
    );
  },
}));

const { GET } = await import('@/app/api/feed/[file]/route');

const USER = '00000000-0000-4000-8000-00000000f001';
let token = '';

function get(file: string) {
  return GET(new Request(`https://runway.test/api/feed/${file}`, { headers: { 'user-agent': 'iOS/19.0 dataaccessd/1.0' } }), {
    params: Promise.resolve({ file }),
  });
}

describe('GET /api/feed/<token>.ics', () => {
  beforeEach(() => {
    token = newFeedToken();
    state.rows = [{ id: 'row1', user_id: USER, provider: 'ics_feed', meta: { token_hash: hashFeedToken(token) } }];
    state.updates = 0;
    state.loadedFor = [];
  });

  it("serves the owner's events as text/calendar", async () => {
    const res = await get(`${token}.ics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(state.loadedFor).toEqual([USER]);
    const body = await res.text();
    const events = Object.values(ical.sync.parseICS(body)).filter((c) => c?.type === 'VEVENT');
    expect(events.map((e) => (e as { uid: string }).uid)).toContain('item:a1@runway');
  });

  it('records when the feed was read, at most every five minutes', async () => {
    await get(`${token}.ics`);
    expect(state.updates).toBe(1);
    expect(state.rows[0]!.meta.last_fetched_by).toBe('iOS/19.0 dataaccessd/1.0');
    expect(state.rows[0]!.meta.token_hash).toBe(hashFeedToken(token));
    await get(`${token}.ics`);
    expect(state.updates).toBe(1);
  });

  it('answers 404 for an unknown token, a malformed one, or a missing .ics', async () => {
    for (const file of [`${newFeedToken()}.ics`, 'nope.ics', token]) {
      const res = await get(file);
      expect(res.status).toBe(404);
    }
    expect(state.loadedFor).toEqual([]);
  });

  it('stops answering for a token of another provider', async () => {
    state.rows[0]!.provider = 'learn_ics';
    expect((await get(`${token}.ics`)).status).toBe(404);
  });
});
