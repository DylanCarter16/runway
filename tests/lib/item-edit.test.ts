import { describe, expect, it } from 'vitest';
import { buildItemUpdate, whenFromForm, type ItemSnapshot } from '@/lib/items/edit';
import { fromTorontoLocal } from '@/lib/time';

const midterm: ItemSnapshot = {
  course_id: 'c1',
  kind: 'midterm',
  title: 'Midterm',
  due_at: fromTorontoLocal('2026-10-29', '16:30').toISOString(),
  starts_at: fromTorontoLocal('2026-10-29', '16:30').toISOString(),
  ends_at: fromTorontoLocal('2026-10-29', '18:20').toISOString(),
  all_day: false,
  time_known: true,
  weight_percent: 30,
  location: null,
  seat: null,
  description: 'Seat on Odyssey.',
  locked_fields: [],
};

const form = {
  courseId: 'c1',
  kind: 'midterm',
  title: 'Midterm',
  date: '2026-10-29',
  time: '16:30',
  weight: 30,
};

describe('whenFromForm', () => {
  it('stores date-only items at local midnight as all day', () => {
    expect(whenFromForm({ date: '2026-09-30', time: null })).toEqual({
      due_at: '2026-09-30T04:00:00.000Z',
      all_day: true,
      time_known: false,
    });
  });

  it('clears the date when none is given', () => {
    expect(whenFromForm({ date: null, time: null })).toEqual({ due_at: null, all_day: true, time_known: false });
  });
});

describe('buildItemUpdate', () => {
  it('changes nothing but the audit fields when the form matches', () => {
    const update = buildItemUpdate(midterm, form);
    expect(update).toEqual({ locked_fields: [], last_change_source: 'manual' });
  });

  it('locks edited fields and keeps the exam duration when the date moves across DST', () => {
    const update = buildItemUpdate(midterm, { ...form, date: '2026-11-05' });
    expect(update.due_at).toBe('2026-11-05T21:30:00.000Z');
    expect(update.starts_at).toBe('2026-11-05T21:30:00.000Z');
    expect(update.ends_at).toBe('2026-11-05T23:20:00.000Z');
    expect(update.locked_fields).toEqual(['due_at', 'starts_at', 'ends_at']);
    expect(update.last_change_source).toBe('manual');
  });

  it('keeps earlier locks and adds new ones', () => {
    const update = buildItemUpdate({ ...midterm, locked_fields: ['title'] }, { ...form, weight: 25 });
    expect(update.locked_fields).toEqual(['title', 'weight_percent']);
    expect(update.weight_percent).toBe(25);
  });
});
