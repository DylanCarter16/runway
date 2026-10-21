import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types';
import { StorageReadLimitError, recordStorageRead } from '@/lib/files/storage-reads';
import { EXPORT_TABLES, type ExportFile, type ExportInput, type ExportRow, type ExportTable } from './build';

// Reads everything for the export through the signed-in user's client, so RLS decides
// what is included. PostgREST caps a response at 1,000 rows, so each table is paged.

const PAGE = 1000;
const LIBRARY_BUCKET = 'library';

async function loadTable(db: SupabaseClient, table: ExportTable): Promise<ExportRow[]> {
  const key = table === 'settings' ? 'user_id' : 'id';
  const rows: ExportRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from(table)
      .select('*')
      .order(key)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not read ${table}: ${error.message}`);
    rows.push(...((data ?? []) as ExportRow[]));
    if (!data || data.length < PAGE) return rows;
  }
}

async function loadFiles(db: SupabaseClient, documents: ExportRow[]): Promise<{ files: ExportFile[]; missingFiles: string[] }> {
  const byPath = new Map<string, string>();
  for (const d of documents) if (typeof d.storage_path === 'string' && d.storage_path.length > 0 && !byPath.has(d.storage_path)) byPath.set(d.storage_path, String(d.id));
  const files: ExportFile[] = [];
  const missingFiles: string[] = [];
  for (const [path, documentId] of byPath) {
    try {
      await recordStorageRead(db as SupabaseClient<Database>, documentId, 'export');
    } catch (e) {
      if (!(e instanceof StorageReadLimitError)) throw e;
      missingFiles.push(path);
      continue;
    }
    const { data, error } = await db.storage.from(LIBRARY_BUCKET).download(path);
    if (error || !data) missingFiles.push(path);
    else files.push({ path, bytes: new Uint8Array(await data.arrayBuffer()) });
  }
  return { files, missingFiles };
}

export async function loadExport(db: SupabaseClient, now: Date): Promise<ExportInput> {
  const loaded = await Promise.all(EXPORT_TABLES.map((t) => loadTable(db, t)));
  const tables = Object.fromEntries(EXPORT_TABLES.map((t, i) => [t, loaded[i]])) as Record<ExportTable, ExportRow[]>;
  const { files, missingFiles } = await loadFiles(db, tables.documents);
  return { exportedAt: now, tables, files, missingFiles };
}
