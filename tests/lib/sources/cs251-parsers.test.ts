import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCs251Assignments, parseDueCell } from '@/lib/sources/cs251-assignments';
import { parseCs251ExamInfo, parseExamWhen } from '@/lib/sources/cs251-examinfo';
import { parseCs251Schedule, parseDateCell } from '@/lib/sources/cs251-schedule';
import { stripComments } from '@/lib/sources/html';

const dir = path.resolve(import.meta.dirname, '../../fixtures/pages');
const read = (name: string) => readFileSync(path.join(dir, name), 'utf8');
const expected = (name: string) => JSON.parse(read(name));

describe('CS 251 page parsers match the expected fixtures exactly', () => {
  it('schedule', () => {
    const exp = expected('cs251-schedule-f26.expected.json');
    const events = parseCs251Schedule(read(exp.fixture), { pageUrl: exp.pageUrl, termYear: exp.termYear });
    expect(events).toEqual(exp.events);
  });

  it('exam info', () => {
    const exp = expected('cs251-examinfo-f26.expected.json');
    const exams = parseCs251ExamInfo(read(exp.fixture), { pageUrl: exp.pageUrl, termYear: exp.termYear });
    expect(exams).toEqual(exp.exams);
  });

  it('assignments', () => {
    const exp = expected('cs251-assignments-f26.expected.json');
    const events = parseCs251Assignments(read(exp.fixture), { pageUrl: exp.pageUrl, termYear: exp.termYear });
    expect(events).toEqual(exp.events);
  });
});

describe('parser details', () => {
  it('strips comments, including one left open at the end', () => {
    expect(stripComments('a<!-- b -->c<!-- d')).toBe('ac');
  });

  it('reads schedule date cells', () => {
    expect(parseDateCell('Sept 30', 2026)).toEqual({ date: '2026-09-30', endDate: null });
    expect(parseDateCell('Sep 10', 2026)).toEqual({ date: '2026-09-10', endDate: null });
    expect(parseDateCell('Oct 13-15', 2026)).toEqual({ date: '2026-10-13', endDate: '2026-10-15' });
    expect(parseDateCell('Nov 30 - Dec 2', 2026)).toEqual({ date: '2026-11-30', endDate: '2026-12-02' });
    expect(parseDateCell(' TBA ', 2026)).toEqual({ date: null, endDate: null });
    expect(parseDateCell('Week 3', 2026)).toBeNull();
  });

  it('reads exam times on both sides of the DST change', () => {
    expect(parseExamWhen('Thursday, November 12, 4:30-6:20pm', 2026)).toEqual({ date: '2026-11-12', start: '16:30', end: '18:20' });
    expect(parseExamWhen('Tuesday, October 27, 11:30-1:00pm', 2026)).toEqual({ date: '2026-10-27', start: '11:30', end: '13:00' });
    expect(parseExamWhen('TBA', 2026)).toBeNull();
  });

  it('keeps the new date when an old one is struck out', () => {
    const html = `<table><tr><td><a href="assignments/a2.pdf">Assignment 2</a></td>
      <td><s>Wednesday October 8th</s> Friday October 10th &mdash; 10:00pm</td></tr></table>`;
    const [a2] = parseCs251Assignments(html, { pageUrl: 'https://student.cs.uwaterloo.ca/~cs251/F26/assignments.shtml', termYear: 2026 });
    expect(a2).toMatchObject({ sourceRef: 'cs251:A2', date: '2026-10-10', time: '22:00', timeKnown: true, flags: ['date_changed'] });
    expect(a2.sourceUrl).toBe('https://student.cs.uwaterloo.ca/~cs251/F26/assignments/a2.pdf');
  });

  it('reads a due cell with no time as date only', () => {
    expect(parseDueCell('Monday November 3rd', 2026)).toEqual({ date: '2026-11-03', time: null });
  });
});
