import { describe, expect, it } from 'vitest';
import { formatDue, fromTorontoLocal, startOfTorontoDay, toTorontoDate } from '@/lib/time';

describe('fromTorontoLocal', () => {
  it('converts an EST local time (after the Nov 1, 2026 DST change) to UTC', () => {
    // Acceptance check from docs/PHASES.md, Phase 0.
    expect(fromTorontoLocal('2026-11-12', '16:30').toISOString()).toBe('2026-11-12T21:30:00.000Z');
  });

  it('converts an EDT local time (before the Nov 1, 2026 DST change) to UTC', () => {
    expect(fromTorontoLocal('2026-10-25', '16:30').toISOString()).toBe('2026-10-25T20:30:00.000Z');
  });

  it('uses local midnight when time is null', () => {
    expect(fromTorontoLocal('2026-11-12', null).toISOString()).toBe('2026-11-12T05:00:00.000Z');
    expect(fromTorontoLocal('2026-10-25', null).toISOString()).toBe('2026-10-25T04:00:00.000Z');
  });

  it('handles the DST changeover date itself (clocks fall back at 2am EDT)', () => {
    // Nov 1, 2026: before 2am is still EDT (UTC-4); midnight is unambiguous.
    expect(fromTorontoLocal('2026-11-01', null).toISOString()).toBe('2026-11-01T04:00:00.000Z');
    // By evening the same day, EST (UTC-5) is in effect.
    expect(fromTorontoLocal('2026-11-01', '16:30').toISOString()).toBe('2026-11-01T21:30:00.000Z');
  });
});

describe('toTorontoDate', () => {
  it('round-trips a UTC instant back to its America/Toronto calendar date', () => {
    expect(toTorontoDate(fromTorontoLocal('2026-11-12', '16:30'))).toBe('2026-11-12');
    expect(toTorontoDate(fromTorontoLocal('2026-10-25', '16:30'))).toBe('2026-10-25');
  });

  it('is stable across the DST boundary for a fixed local time', () => {
    // 23:30 local should never spill into the next UTC calendar date's
    // Toronto date, on either side of the changeover.
    expect(toTorontoDate(fromTorontoLocal('2026-10-31', '23:30'))).toBe('2026-10-31');
    expect(toTorontoDate(fromTorontoLocal('2026-11-01', '23:30'))).toBe('2026-11-01');
  });
});

describe('startOfTorontoDay', () => {
  it('returns local midnight for an instant later in the same Toronto day', () => {
    const midAfternoon = fromTorontoLocal('2026-11-12', '16:30');
    expect(startOfTorontoDay(midAfternoon).toISOString()).toBe('2026-11-12T05:00:00.000Z');
  });

  it('is idempotent', () => {
    const start = startOfTorontoDay(fromTorontoLocal('2026-10-25', '16:30'));
    expect(startOfTorontoDay(start).toISOString()).toBe(start.toISOString());
  });
});

describe('formatDue', () => {
  it('includes the time when time_known is true', () => {
    expect(formatDue(fromTorontoLocal('2026-11-12', '16:30'), true)).toBe('Nov 12, 4:30 PM');
  });

  it('omits the time when time_known is false', () => {
    expect(formatDue(fromTorontoLocal('2026-11-12', null), false)).toBe('Nov 12');
  });
});
