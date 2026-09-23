import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { learnKind, learnTitle, parseLearnIcs } from '@/lib/sources/learn-ics';
import { syncItems } from '@/lib/sync/items';
import { MemoryStore } from '../sync/memory-store';

const ics = readFileSync(path.resolve(import.meta.dirname, '../../fixtures/sources/learn-feed.ics'), 'utf8');
const courses = [
  { id: 'stat230', learnNames: ['STAT 230', 'STAT230'] },
  { id: 'cs245', learnNames: ['CS 245', 'CS245'] },
];
const window = { startsOn: '2026-09-08', endsOn: '2026-12-22' };

describe('LEARN feed parser', () => {
  const result = parseLearnIcs(ics, courses, window);

  it('matches events to courses by summary, location, or description', () => {
    expect(result.matched.map((i) => [i.sourceRef, i.courseId])).toEqual([
      ['fixture-1001@learn.example', 'stat230'],
      ['fixture-1002@learn.example', 'cs245'],
      ['fixture-1003@learn.example', 'stat230'],
    ]);
  });

  it('uses DTEND for timed events, converted from the feed time zone', () => {
    const quiz = result.matched[0];
    expect(quiz).toMatchObject({ kind: 'quiz', title: 'Online Quiz 3' });
    expect(quiz.when).toEqual({ type: 'timed', dueAt: '2026-10-17T03:59:00.000Z', startsAt: null, endsAt: null });
    const a4 = result.matched[1];
    expect(a4).toMatchObject({ kind: 'assignment', title: 'Assignment 4' });
    expect(a4.when).toMatchObject({ dueAt: '2026-11-06T04:59:00.000Z' }); // Nov 5, 11:59 pm EST
  });

  it('keeps date-only events as all-day on their start date', () => {
    expect(result.matched[2].when).toEqual({ type: 'date', date: '2026-11-03', endDate: null });
  });

  it('sends events that match no course to the review queue', () => {
    expect(result.unmatched.map((i) => i.sourceRef)).toEqual(['fixture-1004@learn.example']);
  });

  it('skips events outside the term window', () => {
    expect(result.skipped).toBe(1);
  });

  it('rejects a page that is not a calendar with a readable message', () => {
    expect(() => parseLearnIcs('<html>Sign in</html>', courses, window)).toThrow(/did not return a calendar/);
  });

  it('reads kinds and titles', () => {
    expect(learnKind('Term Test 1')).toBe('midterm');
    expect(learnKind('Final Exam')).toBe('final');
    expect(learnKind('Lab report')).toBe('assignment');
    expect(learnTitle('Assignment 1 - Due')).toBe('Assignment 1');
  });

  it('is idempotent through the sync', async () => {
    const store = new MemoryStore();
    const opts = { rowSource: 'learn_ics' as const, changeSource: 'learn_ics' as const, ownedFlags: [], trackMissing: { now: new Date('2026-09-23T12:00:00Z') } };
    await syncItems(store, result.matched, opts);
    const writes = store.writes;
    const second = await syncItems(store, parseLearnIcs(ics, courses, window).matched, opts);
    expect(second).toMatchObject({ created: 0, updated: 0, missing: 0 });
    expect(store.writes).toBe(writes);
    expect(store.items.find((i) => i.source_ref === 'fixture-1003@learn.example')).toMatchObject({ all_day: true, due_at: '2026-11-03T05:00:00.000Z' });
  });
});
