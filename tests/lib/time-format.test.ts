import { describe, expect, it } from 'vitest';
import {
  addDaysToDate,
  formatCountdown,
  formatHeadingDate,
  formatListDate,
  formatTime,
  formatWhen,
  fromTorontoLocal,
  termWeek,
} from '@/lib/time';

describe('display formats', () => {
  it('formats list dates, headings, and times in Toronto time', () => {
    const at = fromTorontoLocal('2026-09-30', '22:00');
    expect(formatListDate(at)).toBe('Wed, Sep 30');
    expect(formatHeadingDate(at)).toBe('Wednesday, September 30');
    expect(formatTime(at)).toBe('10:00 pm');
    expect(formatWhen(at, true)).toBe('Wed, Sep 30, 10:00 pm');
    expect(formatWhen(fromTorontoLocal('2026-09-30', null), false)).toBe('Wed, Sep 30, time not set');
  });

  it('keeps local times right after the DST change', () => {
    expect(formatTime(fromTorontoLocal('2026-11-12', '16:30'))).toBe('4:30 pm');
    expect(formatListDate(fromTorontoLocal('2026-11-01', null))).toBe('Sun, Nov 1');
  });
});

describe('formatCountdown', () => {
  const now = fromTorontoLocal('2026-09-15', '10:00');

  it('counts days, hours, and minutes', () => {
    expect(formatCountdown(fromTorontoLocal('2026-09-30', '22:00'), true, now)).toBe('in 15 days');
    expect(formatCountdown(fromTorontoLocal('2026-09-15', '15:00'), true, now)).toBe('in 5 hours');
    expect(formatCountdown(fromTorontoLocal('2026-09-15', '10:30'), true, now)).toBe('in 30 minutes');
    expect(formatCountdown(fromTorontoLocal('2026-09-15', '08:00'), true, now)).toBe('overdue by 2 hours');
    expect(formatCountdown(fromTorontoLocal('2026-09-15', '09:00'), true, now)).toBe('overdue by 1 hour');
  });

  it('uses calendar days for date-only items', () => {
    expect(formatCountdown(fromTorontoLocal('2026-09-15', null), false, now)).toBe('today');
    expect(formatCountdown(fromTorontoLocal('2026-09-16', null), false, now)).toBe('tomorrow');
    expect(formatCountdown(fromTorontoLocal('2026-09-18', null), false, now)).toBe('in 3 days');
    expect(formatCountdown(fromTorontoLocal('2026-09-13', null), false, now)).toBe('overdue by 2 days');
  });
});

describe('termWeek', () => {
  it('starts week 1 on the Monday of the first class week', () => {
    expect(termWeek('2026-09-09', '2026-12-22', fromTorontoLocal('2026-09-09', '09:00'))).toBe(1);
    expect(termWeek('2026-09-09', '2026-12-22', fromTorontoLocal('2026-09-13', '23:00'))).toBe(1);
    expect(termWeek('2026-09-09', '2026-12-22', fromTorontoLocal('2026-09-15', '09:00'))).toBe(2);
    expect(termWeek('2026-09-09', '2026-12-22', fromTorontoLocal('2026-11-02', '09:00'))).toBe(9);
  });

  it('is null outside the term', () => {
    expect(termWeek('2026-09-09', '2026-12-22', fromTorontoLocal('2026-09-01', '09:00'))).toBeNull();
    expect(termWeek('2026-09-09', '2026-12-22', fromTorontoLocal('2026-12-23', '09:00'))).toBeNull();
  });
});

describe('addDaysToDate', () => {
  it('crosses month ends and the DST change', () => {
    expect(addDaysToDate('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDaysToDate('2026-10-31', 2)).toBe('2026-11-02');
    expect(addDaysToDate('2026-10-12', -7)).toBe('2026-10-05');
  });
});
