import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  examRowSchema,
  importantDateSchema,
  mapExamRows,
  mapImportantDates,
  mapTerm,
  parseApiTime,
  parseDuration,
} from '@/lib/sources/open-data';

const dir = path.resolve(import.meta.dirname, '../../fixtures/sources');
const json = (name: string) => JSON.parse(readFileSync(path.join(dir, name), 'utf8'));

const courses = [
  { id: 'c-stat230', code: 'STAT 230', slug: 'stat230', sections: ['001'] },
  { id: 'c-cs245', code: 'CS 245', slug: 'cs245', sections: ['003'] },
  { id: 'c-cs246', code: 'CS 246', slug: 'cs246', sections: ['002'] },
  { id: 'c-cs251', code: 'CS 251', slug: 'cs251', sections: ['001'] },
];

describe('UW Open Data mappers', () => {
  const rows = examRowSchema.array().parse(json('open-data-exams-1269.json'));
  const finals = mapExamRows(rows, courses);

  it('maps finals to courses, picking the row with Dylan’s section', () => {
    expect(finals.map((f) => [f.sourceRef, f.courseId])).toEqual([
      ['final:stat230', 'c-stat230'],
      ['final:cs246', 'c-cs246'],
      ['final:cs251', 'c-cs251'],
    ]);
    const cs246 = finals.find((f) => f.sourceRef === 'final:cs246')!;
    expect(cs246.location).toBe('PAC');
    expect(cs246.description).toContain('Bring your WatCard');
  });

  it('converts start time and duration in Toronto time (EST in December)', () => {
    const cs251 = finals.find((f) => f.sourceRef === 'final:cs251')!;
    expect(cs251.when).toEqual({
      type: 'timed',
      dueAt: '2026-12-14T14:00:00.000Z',
      startsAt: '2026-12-14T14:00:00.000Z',
      endsAt: '2026-12-14T16:30:00.000Z',
    });
    expect(cs251).toMatchObject({ kind: 'final', title: 'Final exam', location: 'PAC' });
  });

  it('keeps a date with no time as date only, and does not match CS 2510 to CS 251', () => {
    expect(finals.find((f) => f.sourceRef === 'final:stat230')!.when).toEqual({ type: 'date', date: '2026-12-22', endDate: null });
    expect(finals.filter((f) => f.courseId === 'c-cs251')).toHaveLength(1);
  });

  it('keeps only the current term’s important dates', () => {
    const dates = mapImportantDates(importantDateSchema.array().parse(json('open-data-important-dates.json')), 'Fall 2026');
    expect(dates).toEqual([
      expect.objectContaining({ sourceRef: 'date:41', kind: 'break', title: 'Reading week', when: { type: 'date', date: '2026-10-12', endDate: '2026-10-16' } }),
      expect.objectContaining({ sourceRef: 'date:7', kind: 'admin', when: { type: 'date', date: '2026-11-13', endDate: null } }),
    ]);
  });

  it('reads term dates', () => {
    expect(mapTerm(json('open-data-term-1269.json'))).toEqual({ startsOn: '2026-09-01', endsOn: '2026-12-31' });
    expect(mapTerm({})).toBeNull();
  });

  it('parses API times and durations', () => {
    expect(parseApiTime('7:30 PM')).toBe('19:30');
    expect(parseApiTime('09:00:00')).toBe('09:00');
    expect(parseApiTime('12:00 AM')).toBe('00:00');
    expect(parseApiTime('soon')).toBeNull();
    expect(parseDuration('02:30:00')).toBe(150);
    expect(parseDuration(150)).toBe(150);
    expect(parseDuration('')).toBeNull();
  });
});
