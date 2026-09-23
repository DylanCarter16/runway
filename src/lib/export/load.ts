import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
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
  const paths = [...new Set(documents.map((d) => d.storage_path).filter((p): p is string => typeof p === 'string' && p.length > 0))];
  const files: ExportFile[] = [];
  const missingFiles: string[] = [];
  for (const path of paths) {
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
