import { describe, expect, it } from 'vitest';
import { planReminderWrites, reminderCatalog, type CatalogInput, type ExistingReminder } from '@/lib/reminders/catalog';

function input(over: Partial<CatalogInput> = {}): CatalogInput {
  return {
    term: { code: '1269', startsOn: '2026-09-09', endsOn: '2026-12-22' },
    classesEndOn: '2026-12-08',
    courses: [
      {
        id: 'c-stat',
        slug: 'stat230',
        code: 'STAT 230',
        hasMeetings: true,
        usesLearn: true,
        piazzaUrl: 'https://piazza.com/class/<PIAZZA_CLASS_4>',
      },
      {
        id: 'c-251',
        slug: 'cs251',
        code: 'CS 251',
        hasMeetings: true,
        usesLearn: false,
        piazzaUrl: 'https://piazza.com/uwaterloo.ca/fall2026/cs251',
      },
    ],
    exams: [
      {
        id: 'e1',
        courseId: 'c-251',
        courseCode: 'CS 251',
        kind: 'midterm',
        title: 'Midterm',
        at: '2026-11-12T21:30:00.000Z',
        seat: null,
      },
      {
        id: 'e2',
        courseId: 'c-stat',
        courseCode: 'STAT 230',
        kind: 'midterm',
        title: 'Midterm 1',
        at: '2026-10-08T20:30:00.000Z',
        seat: '12',
      },
      {
        id: 'e0',
        courseId: 'c-stat',
        courseCode: 'STAT 230',
        kind: 'midterm',
        title: 'Old',
        at: '2026-09-01T20:30:00.000Z',
        seat: null,
      },
    ],
    finalsImported: false,
    // Wednesday, Sep 23, 2026, noon in Toronto.
    now: new Date('2026-09-23T16:00:00Z'),
    ...over,
  };
}

describe('reminderCatalog', () => {
  const drafts = reminderCatalog(input());
  const byKey = new Map(drafts.map((d) => [d.dedupe_key, d]));

  it('asks for a seat 3 days before each upcoming exam, and marks it done once the seat is known', () => {
    expect(byKey.get('seat:e1')).toMatchObject({
      kind: 'check',
      title: 'Check Odyssey for your CS 251 midterm seat',
      remind_at: '2026-11-09T14:00:00.000Z', // 9:00 EST
      item_id: 'e1',
      done: false,
    });
    expect(byKey.get('seat:e2')).toMatchObject({
      title: 'Check Odyssey for your STAT 230 midterm 1 seat',
      done: true,
    });
    expect(byKey.has('seat:e0')).toBe(false);
  });

  it('adds the next Sunday sweep and LEARN announcement reminders at 18:00', () => {
    expect(byKey.get('sweep:2026-09-27')).toMatchObject({
      remind_at: '2026-09-27T22:00:00.000Z',
      url: '/inbox',
    });
    expect(byKey.get('learn_announcements:stat230:2026-09-27')).toMatchObject({
      course_id: 'c-stat',
    });
    expect([...byKey.keys()].some((k) => k.startsWith('learn_announcements:cs251'))).toBe(false);
  });

  it('links Piazza Resources for class URLs and keeps other Piazza links as they are', () => {
    expect(byKey.get('piazza_resources:stat230')?.url).toBe('https://piazza.com/class/<PIAZZA_CLASS_4>/resources');
    expect(byKey.get('piazza_resources:cs251')?.url).toBe('https://piazza.com/uwaterloo.ca/fall2026/cs251');
  });

  it('marks the Quest paste done when every course has its sections, and the finals check done once finals arrive', () => {
    expect(byKey.get('quest_schedule:1269')?.done).toBe(true);
    expect(byKey.get('finals_check:1269')).toMatchObject({
      done: false,
      remind_at: '2026-10-03T13:00:00.000Z',
    });
    const later = reminderCatalog(input({ finalsImported: true }));
    expect(later.find((d) => d.dedupe_key === 'finals_check:1269')?.done).toBe(true);
  });

  it('generates no weekly reminders after the term', () => {
    const after = reminderCatalog(input({ now: new Date('2027-01-05T16:00:00Z') }));
    expect(after.some((d) => d.dedupe_key.startsWith('sweep:') || d.dedupe_key.startsWith('learn_'))).toBe(false);
  });
});

describe('planReminderWrites', () => {
  const now = new Date('2026-09-23T16:00:00Z');
  const drafts = reminderCatalog(input());

  function existing(over: Partial<ExistingReminder> & { dedupe_key: string }): ExistingReminder {
    const d = drafts.find((x) => x.dedupe_key === over.dedupe_key);
    return {
      id: `r-${over.dedupe_key}`,
      title: d?.title ?? 'x',
      where_to_find: d?.where_to_find ?? null,
      url: d?.url ?? null,
      remind_at: d?.remind_at ?? now.toISOString(),
      course_id: d?.course_id ?? null,
      item_id: d?.item_id ?? null,
      done_at: null,
      ...over,
    };
  }

  it('inserts open drafts and skips ones already done', () => {
    const writes = planReminderWrites([], drafts, now);
    const keys = writes.inserts.map((d) => d.dedupe_key);
    expect(keys).toContain('seat:e1');
    expect(keys).not.toContain('seat:e2');
    expect(keys).not.toContain('quest_schedule:1269');
    expect(writes.updates).toEqual([]);
  });

  it('writes nothing the second time', () => {
    const first = planReminderWrites([], drafts, now);
    const rows = first.inserts.map((d) => existing({ ...d, id: `r-${d.dedupe_key}`, done_at: null }));
    expect(planReminderWrites(rows, drafts, now)).toEqual({
      inserts: [],
      updates: [],
    });
  });

  it('moves an open seat check with its exam, and closes it when the seat arrives', () => {
    const moved = existing({
      dedupe_key: 'seat:e1',
      remind_at: '2026-11-01T14:00:00.000Z',
    });
    expect(planReminderWrites([moved], drafts, now).updates).toEqual([
      { id: 'r-seat:e1', patch: { remind_at: '2026-11-09T14:00:00.000Z' } },
    ]);
    const filled = existing({ dedupe_key: 'seat:e2' });
    expect(planReminderWrites([filled], drafts, now).updates).toEqual([{ id: 'r-seat:e2', patch: { done_at: now.toISOString() } }]);
  });

  it('never reopens a reminder Dylan closed, and closes seat checks whose exam is gone', () => {
    const closed = existing({
      dedupe_key: 'seat:e1',
      remind_at: '2026-11-01T14:00:00.000Z',
      done_at: '2026-09-20T00:00:00Z',
    });
    expect(planReminderWrites([closed], drafts, now).updates).toEqual([]);
    const orphan = existing({ dedupe_key: 'seat:gone' });
    expect(planReminderWrites([orphan], drafts, now).updates).toEqual([{ id: 'r-seat:gone', patch: { done_at: now.toISOString() } }]);
  });
});

describe('lecture-note reminders', () => {
  const MWF = [{ component: 'LEC', days: ['Mon', 'Wed', 'Fri'], starts_on: '2026-09-09', ends_on: '2026-12-08' }];
  const TTh = [{ component: 'LEC', days: ['Tue', 'Thu'], starts_on: '2026-09-09', ends_on: '2026-12-08' }];
  const withMeetings = (over: Partial<CatalogInput> = {}) => {
    const base = input(over);
    return { ...base, courses: [{ ...base.courses[0], meetings: MWF }, { ...base.courses[1], meetings: TTh }] };
  };
  const now = new Date('2026-09-23T16:00:00Z');

  it('makes one reminder per lecture day at 21:00 listing the courses lecturing that day', () => {
    const notes = reminderCatalog(withMeetings()).filter((d) => d.paste_kind === 'lecture_notes');
    const today = notes.find((d) => d.dedupe_key === 'notes:2026-09-23')!;
    expect(today).toMatchObject({ title: "Paste today's lecture notes: STAT 230", url: '/notes/new', course_id: 'c-stat', done: false, closeOnly: false });
    expect(today.remind_at).toBe('2026-09-24T01:00:00.000Z');
    expect(notes.find((d) => d.dedupe_key === 'notes:2026-09-24')?.title).toBe("Paste today's lecture notes: CS 251");
    // No lectures on weekends, and none during reading week.
    expect(notes.some((d) => d.dedupe_key === 'notes:2026-09-26')).toBe(false);
    const reading = reminderCatalog(withMeetings({ now: new Date('2026-10-12T16:00:00Z'), breaks: [{ from: '2026-10-12', to: '2026-10-16' }] }));
    expect(reading.some((d) => /^notes:2026-10-1[2-6]$/.test(d.dedupe_key))).toBe(false);
  });

  it('closes the day once its notes are saved, and never creates past days', () => {
    const drafts = reminderCatalog(withMeetings({ notesOn: ['c-stat|2026-09-23'] }));
    expect(drafts.find((d) => d.dedupe_key === 'notes:2026-09-23')?.done).toBe(true);
    const writes = planReminderWrites([], drafts, now);
    expect(writes.inserts.some((d) => d.dedupe_key === 'notes:2026-09-22')).toBe(false);
    expect(writes.inserts.some((d) => d.dedupe_key === 'notes:2026-09-23')).toBe(false);
    expect(writes.inserts.some((d) => d.dedupe_key === 'notes:2026-09-24')).toBe(true);
    const past = drafts.find((d) => d.dedupe_key === 'notes:2026-09-22')!;
    const yesterday: ExistingReminder = {
      id: 'r-notes:2026-09-22',
      dedupe_key: past.dedupe_key,
      title: past.title,
      where_to_find: past.where_to_find,
      url: past.url,
      remind_at: past.remind_at,
      course_id: past.course_id,
      item_id: null,
      done_at: null,
    };
    const late = reminderCatalog(withMeetings({ notesOn: ['c-251|2026-09-22'] }));
    expect(planReminderWrites([yesterday], late, now).updates).toEqual([{ id: 'r-notes:2026-09-22', patch: { done_at: now.toISOString() } }]);
  });
});
