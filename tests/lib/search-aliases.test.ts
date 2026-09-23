import { describe, expect, it } from 'vitest';
import { expandQuery, type CourseRef } from '@/lib/search/aliases';

const courses: CourseRef[] = [
  { id: 'c-stat230', code: 'STAT 230', slug: 'stat230' },
  { id: 'c-cs245', code: 'CS 245', slug: 'cs245' },
  { id: 'c-cs246', code: 'CS 246', slug: 'cs246' },
  { id: 'c-cs251', code: 'CS 251', slug: 'cs251' },
];

describe('expandQuery', () => {
  it('uppercases numbered assessments', () => {
    expect(expandQuery('a1', courses)).toEqual({ text: 'A1', course: null, kind: null });
  });

  it('turns a bare course number into a course filter', () => {
    const q = expandQuery('251 a1', courses);
    expect(q.course?.slug).toBe('cs251');
    expect(q.text).toBe('A1');
  });

  it('accepts course codes with or without a space and in any case', () => {
    for (const raw of ['cs251 A1', 'CS 251 a1', 'Cs251 a1', 'a1 cs 251', 'cs-251 a1']) {
      const q = expandQuery(raw, courses);
      expect(q.course?.slug, raw).toBe('cs251');
      expect(q.text, raw).toBe('A1');
    }
  });

  it('leaves only the course when the query names nothing else', () => {
    expect(expandQuery('stat230', courses)).toEqual({ text: '', course: courses[0], kind: null });
    expect(expandQuery('STAT 230', courses).course?.slug).toBe('stat230');
  });

  it('maps mt, midterm, and final to item kinds', () => {
    expect(expandQuery('246 mt', courses)).toEqual({ text: 'midterm', course: courses[2], kind: 'midterm' });
    expect(expandQuery('midterm', courses).kind).toBe('midterm');
    expect(expandQuery('cs245 final', courses)).toEqual({ text: 'final', course: courses[1], kind: 'final' });
  });

  it('keeps ordinary words as typed, including typos for trigram matching', () => {
    expect(expandQuery('odysey', courses)).toEqual({ text: 'odysey', course: null, kind: null });
    expect(expandQuery('  office   hours ', courses).text).toBe('office hours');
  });

  it('ignores numbers that match no course', () => {
    expect(expandQuery('room 999', courses)).toEqual({ text: 'room 999', course: null, kind: null });
  });
});
