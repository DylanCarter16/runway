import { describe, expect, it } from 'vitest';
import { mergeFlags } from '@/lib/sync/merge';
import { runSummary, sourceHealth, type RunRow } from '@/lib/sync/summary';

const run = (started_at: string, ok: boolean | null): RunRow => ({ source: 's', ok, started_at, finished_at: started_at, error: null, stats: {} });

describe('sync summaries', () => {
  it('describes counts in plain words', () => {
    expect(runSummary({ created: 3, updated: 1, unchanged: 5 })).toBe('3 added, 1 updated');
    expect(runSummary({ created: 0, updated: 0, unchanged: 9 })).toBe('No changes');
    expect(runSummary({ notModified: true })).toBe('Unchanged since the last check');
    expect(runSummary({ skipped: 'no feed URL saved' })).toBe('Skipped: no feed URL saved');
    expect(runSummary({ dates: { created: 2 }, finals: { created: 0 }, examRows: 0, replaced: 0 })).toBe(
      'Important dates: 2 added, exam schedule not published yet',
    );
    expect(runSummary({ changed: true, snapshot: 'doc-1', created: 0 })).toBe('Page changed, snapshot saved');
  });

  it('counts failures in a row since the last success', () => {
    const runs = [run('2026-09-23T10:00:00Z', false), run('2026-09-23T09:00:00Z', false), run('2026-09-23T08:00:00Z', true), run('2026-09-23T11:00:00Z', false)];
    const h = sourceHealth(runs);
    expect(h.failStreak).toBe(3);
    expect(h.last?.started_at).toBe('2026-09-23T11:00:00Z');
    expect(h.lastOk?.started_at).toBe('2026-09-23T08:00:00Z');
    expect(sourceHealth([]).last).toBeNull();
  });
});

describe('flag merging', () => {
  it('only adds and removes the flags a source owns', () => {
    expect(mergeFlags(['date_tba', 'location_tba'], [], ['location_tba'])).toEqual(['date_tba']);
    expect(mergeFlags(['date_tba'], ['location_tba', 'other'], ['location_tba'])).toEqual(['date_tba', 'location_tba']);
    expect(mergeFlags(['outline_date_conflict'], ['date_tba'], ['date_tba'])).toEqual(['outline_date_conflict', 'date_tba']);
  });
});
