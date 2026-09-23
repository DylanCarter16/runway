import { describe, expect, it } from 'vitest';
import { eventLabel, planItemEvents, planReminderEvent, studyDays, type PlanItem } from '@/lib/reminders/events';
import { cleanReminders, resolveRule } from '@/lib/reminders/rules';
import { fromTorontoLocal } from '@/lib/time';

const ctx = { appUrl: 'https://runway.example/', studyBlockHour: 19 };
const DAY = 1440;

function item(over: Partial<PlanItem> = {}): PlanItem {
  return {
    id: 'i1',
    kind: 'assignment',
    title: 'A3',
    courseCode: 'CS 251',
    courseSlug: 'cs251',
    due_at: fromTorontoLocal('2026-10-21', '22:00').toISOString(),
    starts_at: null,
    ends_at: null,
    all_day: false,
    time_known: true,
    location: null,
    seat: null,
    state: 'active',
    progress: 'todo',
    created_at: '2026-09-10T12:00:00Z',
    source_url: 'https://student.cs.uwaterloo.ca/~cs251/F26/assignments.html',
    prep_days: null,
    reminder_minutes: null,
    ...over,
  };
}

describe('rules', () => {
  it('keeps at most five valid offsets, largest first', () => {
    expect(cleanReminders([60, 50000, -5, 60, 1440, 10, 20, 30, 40])).toEqual([1440, 60, 40, 30, 20]);
  });

  it('prefers the item, then Settings, then the course default', () => {
    expect(resolveRule('assignment', 'cs246').prepDays).toBe(10);
    expect(resolveRule('assignment', 'cs251').prepDays).toBe(7);
    expect(
      resolveRule('assignment', 'cs251', {
        assignment: { prepDays: 5, reminders: [60] },
      }),
    ).toMatchObject({
      prepDays: 5,
      reminders: [60],
    });
    expect(resolveRule('assignment', 'cs251', { assignment: { prepDays: 5 } }, { prep_days: 2, reminder_minutes: [30] })).toMatchObject({
      prepDays: 2,
      reminders: [30],
    });
  });
});

describe('planItemEvents', () => {
  it('turns a timed deadline into a short block ending at the due time, plus prep blocks', () => {
    const events = planItemEvents(item(), ctx);
    expect(events.map((e) => e.runwayId)).toEqual(['item:i1', 'item:i1:prep', 'item:i1:start']);
    const [main, prep, start] = events;
    expect(main.summary).toBe('CS 251 A3');
    expect(main.end).toEqual({ dateTime: '2026-10-22T02:00:00.000Z' });
    expect(main.start).toEqual({ dateTime: '2026-10-22T01:45:00.000Z' });
    // 7d, 3d, 1d, 3h before the due time, counted from the block's start.
    expect(main.reminders).toEqual([7 * DAY - 15, 3 * DAY - 15, DAY - 15, 180 - 15]);
    expect(main.description).toContain('https://runway.example/items/i1');
    expect(prep).toMatchObject({
      summary: 'Prep: CS 251 A3',
      start: { date: '2026-10-14' },
      end: { date: '2026-10-15' },
      transparent: true,
    });
    expect(start).toMatchObject({
      summary: 'Start CS 251 A3',
      start: { dateTime: '2026-10-14T23:00:00.000Z' },
    });
  });

  it('puts blocks at the study hour on both sides of the DST change', () => {
    const after = planItemEvents(item({ due_at: fromTorontoLocal('2026-11-06', '22:00').toISOString() }), ctx);
    // Oct 30 is still EDT (UTC-4); 19:00 local is 23:00 UTC.
    expect(after.find((e) => e.runwayId.endsWith(':start'))?.start).toEqual({
      dateTime: '2026-10-30T23:00:00.000Z',
    });
    const later = planItemEvents(item({ due_at: fromTorontoLocal('2026-11-12', '22:00').toISOString() }), ctx);
    // Nov 5 is EST (UTC-5); 19:00 local is 00:00 UTC the next day.
    expect(later.find((e) => e.runwayId.endsWith(':start'))?.start).toEqual({
      dateTime: '2026-11-06T00:00:00.000Z',
    });
  });

  it('makes date-only items all-day events marked time TBD, with reminders from 9:00', () => {
    const [main] = planItemEvents(
      item({
        due_at: fromTorontoLocal('2026-09-30', null).toISOString(),
        all_day: true,
        time_known: false,
      }),
      ctx,
    );
    expect(main.summary).toBe('CS 251 A3 (time TBD)');
    expect(main.start).toEqual({ date: '2026-09-30' });
    expect(main.end).toEqual({ date: '2026-10-01' });
    // 7d, 3d, 1d before 9:00 counted from midnight; 3h before 9:00 lands on the day and is dropped.
    expect(main.reminders).toEqual([7 * DAY - 540, 3 * DAY - 540, DAY - 540]);
  });

  it('uses the exam time range and adds study blocks instead of a prep block', () => {
    const events = planItemEvents(
      item({
        kind: 'midterm',
        title: 'Midterm',
        due_at: '2026-11-12T21:30:00.000Z',
        starts_at: '2026-11-12T21:30:00.000Z',
        ends_at: '2026-11-12T23:20:00.000Z',
        location: 'STC 0010',
        seat: '45',
      }),
      ctx,
    );
    const [main, ...blocks] = events;
    expect(main).toMatchObject({
      summary: 'CS 251 Midterm',
      start: { dateTime: '2026-11-12T21:30:00.000Z' },
      end: { dateTime: '2026-11-12T23:20:00.000Z' },
      location: 'STC 0010, seat 45',
      reminders: [10 * DAY, 3 * DAY, DAY, 120],
    });
    expect(blocks.map((b) => b.runwayId)).toEqual(['item:i1:study:2026-11-06', 'item:i1:study:2026-11-08', 'item:i1:study:2026-11-10']);
    expect(blocks[0].summary).toBe('Study: CS 251 Midterm');
  });

  it('gives finals a study block every other day from 14 days before', () => {
    expect(studyDays('every_other_day', 14)).toEqual([-14, -12, -10, -8, -6, -4, -2]);
    expect(studyDays('three_in_week', 7)).toEqual([-6, -4, -2]);
  });

  it('skips blocks dated before the item was created', () => {
    const events = planItemEvents(item({ created_at: '2026-10-20T12:00:00Z' }), ctx);
    expect(events.map((e) => e.runwayId)).toEqual(['item:i1']);
  });

  it('marks submitted items with a check and drops their reminders and blocks', () => {
    const events = planItemEvents(item({ progress: 'submitted' }), ctx);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ summary: '✓ CS 251 A3', reminders: [] });
  });

  it('plans nothing for dismissed or undated items', () => {
    expect(planItemEvents(item({ state: 'dismissed' }), ctx)).toEqual([]);
    expect(planItemEvents(item({ due_at: null }), ctx)).toEqual([]);
  });

  it('shows breaks as background all-day events over their whole span', () => {
    const [main, ...rest] = planItemEvents(
      item({
        kind: 'break',
        title: 'Reading week',
        courseCode: null,
        courseSlug: null,
        due_at: fromTorontoLocal('2026-10-10', null).toISOString(),
        starts_at: fromTorontoLocal('2026-10-10', null).toISOString(),
        ends_at: fromTorontoLocal('2026-10-19', null).toISOString(),
        all_day: true,
        time_known: false,
      }),
      ctx,
    );
    expect(rest).toEqual([]);
    expect(main).toMatchObject({
      start: { date: '2026-10-10' },
      end: { date: '2026-10-19' },
      transparent: true,
      reminders: [],
    });
  });

  it('does not repeat a course code the title already has', () => {
    expect(eventLabel('CS 251', 'CS251 A1')).toBe('CS251 A1');
    expect(eventLabel('STAT 230', 'Midterm 1')).toBe('STAT 230 Midterm 1');
    expect(eventLabel(null, 'Drop deadline')).toBe('Drop deadline');
  });
});

describe('planReminderEvent', () => {
  const r = {
    id: 'r1',
    title: 'Weekly sweep',
    where_to_find: 'Runway Inbox',
    url: '/inbox',
    remind_at: '2026-09-27T22:00:00.000Z',
    snoozed_until: null,
    done_at: null,
  };

  it('is a short notifying event at the reminder time, with absolute links', () => {
    const e = planReminderEvent(r, 'https://runway.example')!;
    expect(e).toMatchObject({
      runwayId: 'reminder:r1',
      start: { dateTime: '2026-09-27T22:00:00.000Z' },
      reminders: [0],
    });
    expect(e.description).toContain('https://runway.example/inbox');
  });

  it('moves to the snooze time and disappears when done', () => {
    expect(planReminderEvent({ ...r, snoozed_until: '2026-09-28T22:00:00.000Z' }, 'x')!.start).toEqual({
      dateTime: '2026-09-28T22:00:00.000Z',
    });
    expect(planReminderEvent({ ...r, done_at: '2026-09-28T00:00:00Z' }, 'x')).toBeNull();
  });
});

describe('reminder offsets', () => {
  it('parses and formats the Settings text', async () => {
    const { formatOffset, parseOffsets } = await import('@/lib/reminders/rules');
    expect(parseOffsets('7d, 3d 1d,3h')).toEqual({ ok: true, minutes: [10080, 4320, 1440, 180] });
    expect(parseOffsets('')).toEqual({ ok: true, minutes: [] });
    expect(parseOffsets('5 weeks').ok).toBe(false);
    expect(parseOffsets('29d').ok).toBe(false);
    expect(parseOffsets('1d 2d 3d 4d 5d 6d').ok).toBe(false);
    expect([10080, 180, 30, 0].map(formatOffset)).toEqual(['7d', '3h', '30m', '0m']);
  });
});
