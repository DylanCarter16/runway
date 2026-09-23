import { describe, expect, it } from 'vitest';
import { applyDiff, diffCalendar, toDesired } from '@/lib/gcal/sync';
import { planItemEvents, type PlanItem } from '@/lib/reminders/events';
import { fromTorontoLocal } from '@/lib/time';
import { FakeCalendar } from './fake-calendar';

const ctx = { appUrl: 'https://runway.example', studyBlockHour: 19 };

function a1(over: Partial<PlanItem> = {}): PlanItem {
  return {
    id: 'a1',
    kind: 'assignment',
    title: 'A1',
    courseCode: 'CS 251',
    courseSlug: 'cs251',
    due_at: fromTorontoLocal('2026-09-30', null).toISOString(),
    starts_at: null,
    ends_at: null,
    all_day: true,
    time_known: false,
    location: null,
    seat: null,
    state: 'active',
    progress: 'todo',
    created_at: '2026-09-20T12:00:00Z',
    source_url: null,
    prep_days: null,
    reminder_minutes: null,
    ...over,
  };
}

async function sync(cal: FakeCalendar, items: PlanItem[]) {
  cal.writes = [];
  const desired = items.flatMap((i) => planItemEvents(i, ctx)).map(toDesired);
  const diff = diffCalendar(desired, await cal.listEvents());
  return applyDiff(cal, 'cal1', diff);
}

describe('calendar sync', () => {
  it('creates the event with the rule reminders, and makes no writes the second time', async () => {
    const cal = new FakeCalendar();
    const first = await sync(cal, [a1()]);
    expect(first).toMatchObject({
      inserted: 3,
      updated: 0,
      removed: 0,
      complete: true,
    });
    const main = cal.byRunwayId('item:a1')!;
    expect(main.summary).toBe('CS 251 A1 (time TBD)');
    expect(main.start).toEqual({ date: '2026-09-30' });
    expect(main.reminders.overrides.map((o) => o.minutes)).toEqual([7 * 1440 - 540, 3 * 1440 - 540, 1440 - 540]);
    expect(first.ids.get('item:a1')).toBeDefined();

    const second = await sync(cal, [a1()]);
    expect(cal.writes).toEqual([]);
    expect(second.ids.get('item:a1')).toBe(first.ids.get('item:a1'));
  });

  it('moves the event when the due date changes', async () => {
    const cal = new FakeCalendar();
    await sync(cal, [a1()]);
    await sync(cal, [
      a1({
        due_at: fromTorontoLocal('2026-10-02', '17:00').toISOString(),
        time_known: true,
        all_day: false,
      }),
    ]);
    expect(cal.writes).toEqual(['update item:a1', 'update item:a1:prep', 'update item:a1:start']);
    expect(cal.byRunwayId('item:a1')!.end).toEqual({
      dateTime: '2026-10-02T21:00:00.000Z',
      timeZone: 'America/Toronto',
    });
  });

  it('deletes every event of a dismissed item', async () => {
    const cal = new FakeCalendar();
    await sync(cal, [a1()]);
    await sync(cal, [a1({ state: 'dismissed' })]);
    expect(cal.writes.filter((w) => w.startsWith('delete'))).toHaveLength(3);
    expect(cal.events.size).toBe(0);
  });

  it('keeps a submitted item with a check mark, drops its reminders and its blocks', async () => {
    const cal = new FakeCalendar();
    await sync(cal, [a1()]);
    await sync(cal, [a1({ progress: 'submitted' })]);
    expect(cal.events.size).toBe(1);
    const main = cal.byRunwayId('item:a1')!;
    expect(main.summary).toBe('✓ CS 251 A1 (time TBD)');
    expect(main.reminders.overrides).toEqual([]);
  });

  it('recreates an event deleted in Google, removes duplicates, and leaves hand-made events alone', async () => {
    const cal = new FakeCalendar();
    await sync(cal, [a1()]);
    const [firstId] = cal.events.keys();
    const copy = structuredClone(cal.events.get(firstId)!);
    cal.events.delete(firstId);
    cal.events.set('dup1', copy);
    cal.events.set('dup2', structuredClone(copy));
    cal.events.set('mine', { summary: 'Dentist' });
    await sync(cal, [a1()]);
    expect(cal.writes).toEqual(['delete dup2']);
    expect(cal.events.has('mine')).toBe(true);
  });

  it('stops when the time budget runs out and finishes on the next run', async () => {
    const cal = new FakeCalendar();
    const desired = [a1(), a1({ id: 'a2', title: 'A2' })].flatMap((i) => planItemEvents(i, ctx)).map(toDesired);
    let t = 0;
    const partial = await applyDiff(cal, 'cal1', diffCalendar(desired, []), {
      deadline: 2,
      now: () => t++,
    });
    expect(partial).toMatchObject({ complete: false, inserted: 2 });
    const rest = await applyDiff(cal, 'cal1', diffCalendar(desired, await cal.listEvents()));
    expect(rest).toMatchObject({ complete: true, inserted: 4 });
    expect(cal.events.size).toBe(6);
  });
});
