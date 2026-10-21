import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types';

// The storage egress guard (2026-10-20). Supabase showed 18 GB of cached egress for 30 MB of
// stored files: the same file fetched hundreds of times. Every read of a stored file now goes
// through recordStorageRead, which counts it per document, reader, and Toronto day
// (migration 20261021005208_storage_reads.sql). Settings, Data lists the counts, and a reader
// over its daily cap is refused, so a refetch loop stops and shows up instead of running silently.

export type StorageReadVia = 'viewer' | 'original' | 'worker' | 'export';

/**
 * Reads of one file, per reader, per day. A file is fetched once per step by the worker
 * (a 100-page scan is about 36 steps) and once per browser session by the viewer, so these
 * leave plenty of room for real use and stop a loop within the day.
 */
export const STORAGE_READ_CAPS: Record<StorageReadVia, number> = { worker: 100, viewer: 60, original: 60, export: 20 };

/** Settings flags a file read more than this many times in a day. */
export const STORAGE_READ_WARN = 20;

type Db = SupabaseClient<Database>;

/** A reader went past its daily cap for one file. Not worth retrying until tomorrow. */
export class StorageReadLimitError extends Error {
  constructor(
    public via: StorageReadVia,
    public reads: number,
  ) {
    super(`This file was already read ${reads - 1} times today by the ${via}, so Runway stopped reading it until tomorrow. Settings, Data shows file reads.`);
    this.name = 'StorageReadLimitError';
  }
}

/** PostgREST's answer when the function isn't there yet (the migration is not applied). */
function missingFunction(error: { code?: string; message?: string }): boolean {
  return error.code === 'PGRST202' || error.code === '42883' || error.code === '42P01';
}

/**
 * Counts one read of a stored file and returns today's reads by that reader. Throws
 * StorageReadLimitError past the cap, before anything is downloaded. Until the migration
 * is applied it lets the read through and says so in the log (Settings says so too).
 */
export async function recordStorageRead(db: Db, documentId: string, via: StorageReadVia): Promise<number> {
  const { data, error } = await db.rpc('record_storage_read', { p_document_id: documentId, p_via: via });
  if (error) {
    if (missingFunction(error)) {
      console.warn('storage reads are not counted: apply migration 20261021005208_storage_reads.sql');
      return 0;
    }
    throw new Error(`Could not count a file read: ${error.message}`);
  }
  const reads = data ?? 0;
  if (reads > STORAGE_READ_CAPS[via]) throw new StorageReadLimitError(via, reads);
  return reads;
}

export interface StorageReadRow {
  document_id: string;
  via: string;
  day: string;
  reads: number;
  updated_at: string;
  documents: { title: string } | null;
}

export interface StorageReadSummary {
  documentId: string;
  title: string;
  today: number;
  week: number;
  /** Today's reads by reader, largest first. */
  todayBy: { via: string; reads: number }[];
  lastAt: string;
  flagged: boolean;
}

/** Per-file totals for Settings, most read today first. `today` is a Toronto YYYY-MM-DD. */
export function summarizeStorageReads(rows: StorageReadRow[], today: string): StorageReadSummary[] {
  const byDoc = new Map<string, StorageReadSummary>();
  for (const r of rows) {
    let s = byDoc.get(r.document_id);
    if (!s) {
      s = { documentId: r.document_id, title: r.documents?.title ?? 'A deleted file', today: 0, week: 0, todayBy: [], lastAt: r.updated_at, flagged: false };
      byDoc.set(r.document_id, s);
    }
    s.week += r.reads;
    if (r.updated_at > s.lastAt) s.lastAt = r.updated_at;
    if (r.day === today) {
      s.today += r.reads;
      s.todayBy.push({ via: r.via, reads: r.reads });
    }
  }
  const out = [...byDoc.values()];
  for (const s of out) {
    s.todayBy.sort((a, b) => b.reads - a.reads);
    s.flagged = s.today > STORAGE_READ_WARN;
  }
  return out.sort((a, b) => b.today - a.today || b.week - a.week || a.title.localeCompare(b.title));
}
