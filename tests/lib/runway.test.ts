import { describe, expect, it } from 'vitest';
import { effectiveDue, runwayState, type RunwayInput } from '@/lib/items/runway';
import { prepDaysFor } from '@/lib/reminders/rules';
import { fromTorontoLocal } from '@/lib/time';

const a1: RunwayInput = {
  kind: 'assignment',
  due_at: fromTorontoLocal('2026-09-30', '22:00').toISOString(),
  starts_at: null,
  time_known: true,
  progress: 'todo',
  prep_days: null,
  courseSlug: 'cs251',
};

describe('prepDaysFor', () => {
  it('uses the kind defaults and the CS 246 assignment override', () => {
    expect(prepDaysFor('assignment', 'cs251')).toBe(7);
    expect(prepDaysFor('assignment', 'cs246')).toBe(10);
    expect(prepDaysFor('project', null)).toBe(21);
    expect(prepDaysFor('quiz', 'stat230')).toBe(2);
    expect(prepDaysFor('tutorial', 'stat230')).toBe(0);
    expect(prepDaysFor('assignment', 'cs251', 3)).toBe(3);
  });
});

describe('effectiveDue', () => {
  it('treats a date-only item as due at the end of its local day', () => {
    const due = effectiveDue({ due_at: fromTorontoLocal('2026-09-30', null).toISOString(), starts_at: null, time_known: false });
    expect(due?.toISOString()).toBe(fromTorontoLocal('2026-10-01', null).toISOString());
  });

  it('handles the end of the DST day (Nov 1, 2026 has 25 hours)', () => {
    const due = effectiveDue({ due_at: fromTorontoLocal('2026-11-01', null).toISOString(), starts_at: null, time_known: false });
    expect(due?.toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });

  it('falls back to starts_at for exams without a due time', () => {
    const at = fromTorontoLocal('2026-11-12', '16:30').toISOString();
    expect(effectiveDue({ due_at: null, starts_at: at, time_known: true })?.toISOString()).toBe(at);
  });
});

describe('runwayState', () => {
  it('is upcoming before the prep window opens', () => {
    const s = runwayState(a1, fromTorontoLocal('2026-09-20', '12:00'));
    expect(s.status).toBe('upcoming');
    expect(s.fraction).toBe(0);
    expect(s.start?.toISOString()).toBe(fromTorontoLocal('2026-09-23', '22:00').toISOString());
  });

  it('counts the day inside the window', () => {
    const s = runwayState(a1, fromTorontoLocal('2026-09-26', '23:00'));
    expect(s.status).toBe('active');
    expect(s.label).toBe('Prep window, day 4 of 7');
    expect(s.fraction).toBeGreaterThan(0.4);
    expect(s.fraction).toBeLessThan(0.5);
  });

  it('turns soon inside 48 hours, overdue after the due time, and submitted when done', () => {
    expect(runwayState(a1, fromTorontoLocal('2026-09-29', '09:00')).status).toBe('soon');
    const late = runwayState(a1, fromTorontoLocal('2026-09-30', '23:00'));
    expect(late.status).toBe('overdue');
    expect(late.fraction).toBe(1);
    expect(runwayState({ ...a1, progress: 'submitted' }, fromTorontoLocal('2026-09-30', '23:00')).status).toBe('submitted');
  });

  it('has no window for undated items or kinds without runway', () => {
    expect(runwayState({ ...a1, due_at: null }, new Date()).status).toBe('none');
    expect(runwayState({ ...a1, kind: 'tutorial' }, fromTorontoLocal('2026-09-20', '12:00')).status).toBe('none');
  });
});
