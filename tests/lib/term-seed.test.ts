import { describe, expect, it } from 'vitest';
import { TERM_F26 } from '@/config/term-f26';
import { courseRow, itemRow, linkRows, seedItemPatch } from '@/lib/term/seed';

const ctx = { userId: 'u1', courseId: 'c1', sourceUrl: null };
const course = (slug: string) => TERM_F26.courses.find((c) => c.slug === slug)!;
const seed = (slug: string, ref: string) => course(slug).seedItems.find((i) => i.sourceRef === ref)!;

describe('itemRow', () => {
  it('stores a timed exam with start, end, and due in UTC (EDT side)', () => {
    const row = itemRow(seed('stat230', 'outline:stat230:M1'), ctx);
    expect(row.due_at).toBe('2026-10-08T20:30:00.000Z');
    expect(row.starts_at).toBe('2026-10-08T20:30:00.000Z');
    expect(row.ends_at).toBe('2026-10-08T22:20:00.000Z');
    expect(row.all_day).toBe(false);
    expect(row.time_known).toBe(true);
    expect(row.source).toBe('seed');
    expect(row.last_change_source).toBe('seed');
  });

  it('converts after the DST change (EST side)', () => {
    const cs246 = course('cs246').seedItems.find((i) => i.kind === 'midterm')!;
    expect(cs246.date).toBe('2026-11-10');
    const row = itemRow(cs246, ctx);
    expect(new Date(row.due_at!).getUTCHours()).toBe(Number(cs246.time!.slice(0, 2)) + 5);
  });

  it('stores undated items with no due date and keeps their flags', () => {
    const row = itemRow(seed('cs245', 'outline:cs245:final'), ctx);
    expect(row.due_at).toBeNull();
    expect(row.all_day).toBe(true);
    expect(row.time_known).toBe(false);
    expect(row.flags).toEqual(['date_tba']);
  });

  it('spans multi-day breaks to the end of their last day', () => {
    const week = TERM_F26.termItems.find((i) => i.sourceRef === 'term:1269:reading-week')!;
    const row = itemRow(week, { ...ctx, courseId: null });
    expect(row.due_at).toBe('2026-10-12T04:00:00.000Z');
    expect(row.starts_at).toBe('2026-10-12T04:00:00.000Z');
    expect(row.ends_at).toBe('2026-10-17T04:00:00.000Z');
    expect(row.all_day).toBe(true);
  });
});

describe('term config rows', () => {
  it('keeps every seed item ref unique so the import upsert is idempotent', () => {
    const refs = [...TERM_F26.termItems, ...TERM_F26.courses.flatMap((c) => c.seedItems)].map((i) => i.sourceRef);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it('keeps link URLs unique within each course', () => {
    for (const c of TERM_F26.courses) {
      const urls = c.links.map((l) => l.url);
      expect(new Set(urls).size, c.code).toBe(urls.length);
    }
  });

  it('carries the AI switch and colors onto course rows', () => {
    const stat = courseRow(course('stat230'), { userId: 'u1', termId: 't1', sortOrder: 0 });
    expect(stat.ai_allowed).toBe(true);
    expect(stat.color).toBe('#0F7B83');
    for (const slug of ['cs245', 'cs246', 'cs251']) {
      expect(courseRow(course(slug), { userId: 'u1', termId: 't1', sortOrder: 1 }).ai_allowed, slug).toBe(false);
    }
  });

  it('orders links in config order', () => {
    const rows = linkRows(TERM_F26.globalLinks, { userId: 'u1', courseId: null });
    expect(rows[0].label).toMatch(/Odyssey/);
    expect(rows.map((r) => r.sort_order)).toEqual(rows.map((_, i) => i));
  });
});

describe('tutorial sections', () => {
  it('seeds the current CS 245 and STAT 230 tutorials', () => {
    const tut = (slug: string) => course(slug).meetings.find((m) => m.component === 'TUT')!;
    expect(tut('cs245')).toMatchObject({ section: '103', classNumber: '6434', days: ['Fri'], startTime: '11:30', endTime: '12:20', location: 'MC 4063' });
    expect(tut('stat230')).toMatchObject({ section: '102', classNumber: '6032', days: ['Fri'], startTime: '14:30', endTime: '15:20', location: 'UTD 105', instructor: 'Diana Skrzydlo' });
  });

  it('puts STAT 230 Quiz 2 on Oct 30, 2:30 to 3:20 pm, in UTD 105', () => {
    const row = itemRow(seed('stat230', 'outline:stat230:Q2'), ctx);
    expect(row.starts_at).toBe('2026-10-30T18:30:00.000Z');
    expect(row.ends_at).toBe('2026-10-30T19:20:00.000Z');
    expect(row.location).toBe('UTD 105');
    expect(row.description).toContain('section 102, Fridays 2:30 to 3:20 pm, UTD 105');
  });

  it('moves workshops after the DST change to the same local time', () => {
    const row = itemRow(seed('stat230', 'outline:stat230:W5'), ctx);
    expect(row.starts_at).toBe('2026-11-27T19:30:00.000Z');
    expect(row.location).toBe('UTD 105');
  });
});

describe('seedItemPatch', () => {
  const next = itemRow(seed('stat230', 'outline:stat230:Q2'), ctx);
  // Quiz 2 as loaded before the section change: 3:30 pm, no room.
  const stale = {
    ...next,
    due_at: '2026-10-30T19:30:00+00:00',
    starts_at: '2026-10-30T19:30:00+00:00',
    ends_at: '2026-10-30T20:20:00+00:00',
    location: null,
    description: 'Closed book, in the Friday tutorial slot (section 104, 3:30 to 4:20 pm).',
    locked_fields: [] as string[],
  };

  it('updates the stale time, room, and description in place', () => {
    const patch = seedItemPatch(stale, next)!;
    expect(patch).toMatchObject({
      due_at: next.due_at,
      starts_at: next.starts_at,
      ends_at: next.ends_at,
      location: 'UTD 105',
      description: next.description,
      last_change_source: 'seed',
    });
    expect(patch).not.toHaveProperty('title');
  });

  it('changes nothing when the item already matches (timestamps compared as instants)', () => {
    const current = { ...next, due_at: '2026-10-30T18:30:00+00:00', locked_fields: [] as string[] };
    expect(seedItemPatch(current, next)).toBeNull();
  });

  it("keeps a field Dylan edited", () => {
    const patch = seedItemPatch({ ...stale, locked_fields: ['location'] }, next)!;
    expect(patch).not.toHaveProperty('location');
    expect(patch.due_at).toBe(next.due_at);
  });

  it('keeps the whole timing group when any timing field is locked', () => {
    const patch = seedItemPatch({ ...stale, locked_fields: ['due_at'] }, next)!;
    for (const f of ['due_at', 'starts_at', 'ends_at', 'all_day', 'time_known']) expect(patch).not.toHaveProperty(f);
    expect(patch.location).toBe('UTD 105');
  });
});
