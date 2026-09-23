import { describe, expect, it } from 'vitest';
import { termDatedFilter, termRange } from '@/lib/term/range';

describe('termRange', () => {
  it('runs from Toronto midnight on the first day to Toronto midnight after the last, across the DST change', () => {
    const r = termRange({ starts_on: '2026-09-08', ends_on: '2026-12-22' });
    expect(r.from).toBe('2026-09-08T04:00:00.000Z'); // EDT
    expect(r.to).toBe('2026-12-23T05:00:00.000Z'); // EST
  });

  it('builds a filter on both due and start times', () => {
    expect(termDatedFilter({ starts_on: '2026-09-08', ends_on: '2026-12-22' })).toBe(
      'and(due_at.gte.2026-09-08T04:00:00.000Z,due_at.lt.2026-12-23T05:00:00.000Z),' +
        'and(starts_at.gte.2026-09-08T04:00:00.000Z,starts_at.lt.2026-12-23T05:00:00.000Z)',
    );
  });
});
