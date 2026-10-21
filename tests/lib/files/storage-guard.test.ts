import { describe, expect, it, vi } from 'vitest';
import { FIRST_DELAY_MS, MAX_DELAY_MS, QUIET_LIMIT_MS, combinedStatus, pollStep, startPoll, type PollState } from '@/lib/files/poll';
import { STORAGE_READ_CAPS, STORAGE_READ_WARN, StorageReadLimitError, recordStorageRead, summarizeStorageReads, type StorageReadRow } from '@/lib/files/storage-reads';

// The guard around storage reads (2026-10-20): the Library page's polling ends, and every
// read of a stored file is counted, capped per day, and listed in Settings, Data.

describe('following a file while it is read', () => {
  const reading = (summary: string) => ({ status: 'reading', summary });

  it('refreshes the page only when the status changes, and once more when it finishes', () => {
    let state = startPoll(0);
    let t = 0;
    const refreshes: number[] = [];
    const statuses = [reading('Indexed 150 of 520'), reading('Indexed 150 of 520'), reading('Indexed 300 of 520'), reading('Indexed 300 of 520'), { status: 'done', summary: '520 pages' }];
    for (const s of statuses) {
      t += state.delay;
      const step = pollStep(state, s, t);
      if (step.refresh) refreshes.push(t);
      if (!step.next) break;
      state = step.next;
    }
    expect(refreshes).toHaveLength(2); // 150 to 300, then done
  });

  it('a file stuck at "reading" (its job died) is checked less and less, then not at all', () => {
    let state: PollState | null = startPoll(0);
    let t = 0;
    let checks = 0;
    let refreshes = 0;
    while (state && checks < 10_000) {
      t += state.delay;
      const step = pollStep(state, reading('Reading page 4 of 9'), t);
      checks++;
      if (step.refresh) refreshes++;
      state = step.next;
    }
    expect(state).toBeNull();
    expect(refreshes).toBe(0);
    expect(t).toBeGreaterThanOrEqual(QUIET_LIMIT_MS);
    expect(t).toBeLessThan(QUIET_LIMIT_MS + MAX_DELAY_MS * 2);
    // The old page refreshed every 4 seconds for as long as the tab was open: 225 times in 15 minutes.
    expect(checks).toBeLessThan(30);
  });

  it('keeps going through failed checks without refreshing, and backs off', () => {
    const step = pollStep(startPoll(0), null, FIRST_DELAY_MS);
    expect(step.refresh).toBe(false);
    expect(step.next!.delay).toBeGreaterThan(FIRST_DELAY_MS);
  });

  it('several files read as one: reading while any is, done when all are', () => {
    expect(combinedStatus([null, null])).toBeNull();
    expect(combinedStatus([{ status: 'done', summary: 'a' }, { status: 'reading', summary: 'b' }])!.status).toBe('reading');
    expect(combinedStatus([{ status: 'done', summary: 'a' }, { status: 'failed', summary: 'b' }])!.status).toBe('done');
  });
});

describe('counting storage reads', () => {
  function db(answer: { data?: number | null; error?: { code?: string; message: string } | null }) {
    const rpc = vi.fn(async () => ({ data: answer.data ?? null, error: answer.error ?? null }));
    return { db: { rpc } as never, rpc };
  }

  it('counts one read through the RPC and returns the day count', async () => {
    const { db: client, rpc } = db({ data: 3 });
    await expect(recordStorageRead(client, 'doc-1', 'viewer')).resolves.toBe(3);
    expect(rpc).toHaveBeenCalledWith('record_storage_read', { p_document_id: 'doc-1', p_via: 'viewer' });
  });

  it('refuses a read past the daily cap, before anything is downloaded', async () => {
    const { db: client } = db({ data: STORAGE_READ_CAPS.worker + 1 });
    await expect(recordStorageRead(client, 'doc-1', 'worker')).rejects.toBeInstanceOf(StorageReadLimitError);
  });

  it('lets reads through until the migration is applied, and fails on other errors', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(recordStorageRead(db({ error: { code: 'PGRST202', message: 'no function' } }).db, 'd', 'viewer')).resolves.toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    await expect(recordStorageRead(db({ error: { code: '42501', message: 'permission denied' } }).db, 'd', 'viewer')).rejects.toThrow('permission denied');
  });

  it('summarizes per file for Settings: today, the week, by reader, and flags heavy files first', () => {
    const row = (document_id: string, via: string, day: string, reads: number, title = document_id): StorageReadRow => ({
      document_id,
      via,
      day,
      reads,
      updated_at: `${day}T12:00:00Z`,
      documents: { title },
    });
    const out = summarizeStorageReads(
      [
        row('slides', 'viewer', '2026-10-20', 2),
        row('book', 'worker', '2026-10-20', STORAGE_READ_WARN),
        row('book', 'viewer', '2026-10-20', 4),
        row('book', 'worker', '2026-10-19', 50),
        { ...row('gone', 'export', '2026-10-18', 1), documents: null },
      ],
      '2026-10-20',
    );
    expect(out.map((s) => s.title)).toEqual(['book', 'slides', 'A deleted file']);
    expect(out[0]).toMatchObject({ today: STORAGE_READ_WARN + 4, week: STORAGE_READ_WARN + 54, flagged: true, todayBy: [{ via: 'worker', reads: STORAGE_READ_WARN }, { via: 'viewer', reads: 4 }] });
    expect(out[1].flagged).toBe(false);
  });
});
