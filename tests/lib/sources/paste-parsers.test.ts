import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseOdyssey } from '@/lib/sources/odyssey';
import { parseDays, parseQuestSchedule, to24h } from '@/lib/sources/quest';

const fixture = (name: string) => readFileSync(path.join(__dirname, '../../fixtures/ai', name), 'utf8');

describe('Quest schedule parser', () => {
  it('reads day codes and clock times', () => {
    expect(parseDays('TTh')).toEqual(['Tue', 'Thu']);
    expect(parseDays('MWF')).toEqual(['Mon', 'Wed', 'Fri']);
    expect(parseDays('ThF')).toEqual(['Thu', 'Fri']);
    expect(to24h('12:30PM')).toBe('12:30');
    expect(to24h('12:05AM')).toBe('00:05');
    expect(to24h('4:30PM')).toBe('16:30');
  });

  it('parses a tab-separated paste, including continuation rows', () => {
    const courses = parseQuestSchedule(fixture('quest-tabbed.txt'));
    expect(courses.map((c) => c.code)).toEqual(['CS 251', 'STAT 230']);
    const stat = courses[1];
    expect(stat.title).toBe('Probability');
    expect(stat.meetings).toHaveLength(4);
    expect(stat.meetings[0]).toEqual({
      component: 'LEC',
      section: '001',
      class_number: '6016',
      days: ['Mon', 'Wed', 'Fri'],
      start: '12:30',
      end: '13:20',
      location: 'M3 1006',
      instructor: 'Diana Skrzydlo',
      starts_on: '2026-09-09',
      ends_on: '2026-12-08',
    });
    expect(stat.meetings[1]).toMatchObject({ component: 'TUT', section: '104', days: ['Fri'], start: '15:30', location: 'AL 113' });
    expect(stat.meetings[3]).toMatchObject({ component: 'TST', section: '201', class_number: '6538', starts_on: '2026-11-19', location: null, instructor: null });
    expect(courses[0].meetings[0]).toMatchObject({ days: ['Tue', 'Thu'], start: '10:00', end: '11:20' });
  });

  it('parses a one-cell-per-line paste with TBA times and two instructors', () => {
    const [cs246] = parseQuestSchedule(fixture('quest-cells.txt'));
    expect(cs246.code).toBe('CS 246');
    expect(cs246.meetings).toHaveLength(3);
    expect(cs246.meetings[0]).toMatchObject({ section: '003', days: ['Mon', 'Wed'], start: '14:30', end: '15:50', instructor: 'Ross Evans, Grace Lee' });
    expect(cs246.meetings[1]).toMatchObject({ component: 'TUT', start: '09:30', instructor: null });
    expect(cs246.meetings[2]).toMatchObject({ component: 'TST', days: [], start: null, location: null, starts_on: '2026-11-10' });
  });

  it('returns nothing for text that is not a schedule', () => {
    expect(parseQuestSchedule('Midterm moved to Nov 19.\nSee you in class.')).toEqual([]);
  });
});

describe('Odyssey row parser', () => {
  it('reads a table with a header row by column', () => {
    const rows = parseOdyssey(fixture('odyssey-table.txt'));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      courseCode: 'CS 251',
      kind: 'midterm',
      date: '2026-11-12',
      start: '16:30',
      end: '18:20',
      location: 'PAC 7',
      seat: '112',
    });
    expect(rows[1]).toMatchObject({ courseCode: 'STAT 230', date: '2026-10-08', location: 'M3 1006', seat: null });
  });

  it('reads a single line without a header', () => {
    const [row] = parseOdyssey(fixture('odyssey-line.txt'));
    expect(row).toMatchObject({
      courseCode: 'CS 251',
      kind: 'midterm',
      date: '2026-11-12',
      start: '16:30',
      end: '18:20',
      location: 'STC 0010',
      seat: '45',
    });
  });

  it('ignores lines without a course and a date or time', () => {
    expect(parseOdyssey('Your exam schedule\nNo exams scheduled')).toEqual([]);
  });
});
