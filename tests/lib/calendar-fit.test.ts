import { describe, expect, it } from 'vitest';
import { fitTimedEvent, fromTorontoLocal, MIN_EVENT_MINUTES } from '@/lib/time';

const at = (date: string, time: string) => fromTorontoLocal(date, time);
const iso = (d: Date) => d.toISOString();

describe('fitTimedEvent', () => {
  it('gives a deadline with no end one slot of height', () => {
    const fit = fitTimedEvent(at('2026-10-14', '18:00'), null);
    expect(fit.adjusted).toBe(true);
    expect(iso(fit.start)).toBe(iso(at('2026-10-14', '18:00')));
    expect(iso(fit.end)).toBe(iso(at('2026-10-14', '18:30')));
  });

  it('stretches a zero-length event to one slot', () => {
    const start = at('2026-10-14', '18:00');
    const fit = fitTimedEvent(start, start);
    expect(fit.end.getTime() - fit.start.getTime()).toBe(MIN_EVENT_MINUTES * 60_000);
    expect(iso(fit.start)).toBe(iso(start));
  });

  it('leaves events of a slot or longer alone, even across midnight', () => {
    const start = at('2026-10-14', '16:30');
    const end = at('2026-10-14', '18:20');
    expect(fitTimedEvent(start, end)).toEqual({ start, end, adjusted: false });
    const late = at('2026-10-14', '23:00');
    const after = at('2026-10-15', '01:00');
    expect(fitTimedEvent(late, after).adjusted).toBe(false);
  });

  it('keeps an 11:59 pm deadline inside its own day', () => {
    const fit = fitTimedEvent(at('2026-10-14', '23:59'), null);
    expect(iso(fit.end)).toBe(iso(at('2026-10-15', '00:00')));
    expect(iso(fit.start)).toBe(iso(at('2026-10-14', '23:30')));
  });

  it('ends exactly at midnight when the slot would just reach it', () => {
    const fit = fitTimedEvent(at('2026-10-14', '23:30'), null);
    expect(iso(fit.start)).toBe(iso(at('2026-10-14', '23:30')));
    expect(iso(fit.end)).toBe(iso(at('2026-10-15', '00:00')));
  });

  it('uses EDT midnight the night before the Nov 1, 2026 change', () => {
    const fit = fitTimedEvent(at('2026-10-31', '23:59'), null);
    expect(iso(fit.end)).toBe('2026-11-01T04:00:00.000Z');
    expect(iso(fit.start)).toBe('2026-11-01T03:30:00.000Z');
  });

  it('uses EST midnight at the end of Nov 1, 2026 (a 25-hour day)', () => {
    const fit = fitTimedEvent(at('2026-11-01', '23:59'), null);
    expect(iso(fit.end)).toBe('2026-11-02T05:00:00.000Z');
    expect(iso(fit.start)).toBe('2026-11-02T04:30:00.000Z');
  });

  it('does not touch an item in the repeated 1 am hour on Nov 1', () => {
    // 05:45Z is 1:45 am EDT; 06:45Z is the second 1:45 am, in EST.
    for (const z of ['2026-11-01T05:45:00.000Z', '2026-11-01T06:45:00.000Z']) {
      const fit = fitTimedEvent(new Date(z), null);
      expect(iso(fit.start)).toBe(z);
      expect(fit.end.getTime() - fit.start.getTime()).toBe(30 * 60_000);
    }
  });

  it('measures the day in the zone the calendar draws in', () => {
    // 11:59 pm in Toronto is 8:59 pm in Vancouver: no clamp there.
    const start = at('2026-10-14', '23:59');
    const fit = fitTimedEvent(start, null, 'America/Vancouver');
    expect(iso(fit.start)).toBe(iso(start));
    // 10:59 pm in Toronto is 11:59 pm in Halifax: clamped to Halifax midnight.
    const halifax = fitTimedEvent(at('2026-10-14', '22:59'), null, 'America/Halifax');
    expect(iso(halifax.end)).toBe('2026-10-15T03:00:00.000Z');
  });
});
