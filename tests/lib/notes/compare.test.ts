import { describe, expect, it } from 'vitest';
import { side, wordDiff } from '@/lib/notes/compare';
import { breakRanges, defaultLectureDate, isLectureDay } from '@/lib/notes/lecture-days';

describe('compare view', () => {
  it('marks the changed words', () => {
    const parts = wordDiff('bayes flips teh condition', "Bayes' rule flips the condition");
    expect(parts.filter((p) => p.kind === 'removed').map((p) => p.text.trim())).toEqual(expect.arrayContaining(['teh']));
    expect(parts.filter((p) => p.kind === 'added').map((p) => p.text.trim())).toEqual(expect.arrayContaining(['the']));
    expect(parts.find((p) => p.text.includes('flips'))?.kind).toBe('same');
  });

  it('rebuilds each side from its parts', () => {
    const a = 'p(a|b) = p(ab)/p(b)';
    const b = 'P(A | B) = P(AB) / P(B)';
    const parts = wordDiff(a, b);
    expect(side(parts, 'original').map((p) => p.text).join('')).toBe(a);
    expect(side(parts, 'cleaned').map((p) => p.text).join('')).toBe(b);
  });
});

describe('lecture days', () => {
  const stat230 = [
    { component: 'LEC', days: ['Mon', 'Wed', 'Fri'], starts_on: '2026-09-09', ends_on: '2026-12-08' },
    { component: 'TUT', days: ['Fri'], starts_on: '2026-09-09', ends_on: '2026-12-08' },
    { component: 'TST', days: ['Thu'], starts_on: '2026-10-08', ends_on: '2026-10-08' },
  ];
  const readingWeek = breakRanges([{ due_at: '2026-10-12T04:00:00.000Z', starts_at: '2026-10-12T04:00:00.000Z', ends_at: '2026-10-17T04:00:00.000Z' }]);

  it('reads reading week as Oct 12 to 16', () => {
    expect(readingWeek).toEqual([{ from: '2026-10-12', to: '2026-10-16' }]);
  });

  it('counts only lecture meetings inside their date range, outside breaks', () => {
    expect(isLectureDay(stat230, '2026-09-23')).toBe(true); // Wednesday
    expect(isLectureDay(stat230, '2026-09-24')).toBe(false); // Thursday: only a test section
    expect(isLectureDay(stat230, '2026-09-07')).toBe(false); // before classes start
    expect(isLectureDay(stat230, '2026-10-14', readingWeek)).toBe(false);
  });

  it('defaults a new note to the most recent lecture day', () => {
    expect(defaultLectureDate(stat230, '2026-09-23')).toBe('2026-09-23');
    expect(defaultLectureDate(stat230, '2026-09-27')).toBe('2026-09-25'); // Sunday to Friday
    expect(defaultLectureDate(stat230, '2026-10-17', readingWeek)).toBe('2026-10-09');
    expect(defaultLectureDate([], '2026-09-27')).toBe('2026-09-27');
  });
});
