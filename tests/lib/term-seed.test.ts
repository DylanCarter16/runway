import { describe, expect, it } from 'vitest';
import { TERM_F26 } from '@/config/term-f26';
import { courseRow, itemRow, linkRows } from '@/lib/term/seed';

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
