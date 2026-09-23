import { strToU8, zipSync, type Zippable } from 'fflate';

// Settings, Data export (SPEC 4.10): one zip with every row Dylan owns as JSON, each
// note as Markdown, and any stored library files. Pure, so tests can unzip it.

/** Tables in the export, parents before children. Left out: chunks (rebuilt from
 *  notes and documents), jobs and integration_tokens (server-only; tokens are secrets). */
export const EXPORT_TABLES = [
  'settings',
  'terms',
  'courses',
  'links',
  'watched_pages',
  'documents',
  'items',
  'item_changes',
  'notes',
  'proposals',
  'grades',
  'reminders',
  'ask_threads',
  'ask_messages',
  'sync_runs',
  'ai_calls',
] as const;

export type ExportTable = (typeof EXPORT_TABLES)[number];
export type ExportRow = Record<string, unknown>;

/** Search vectors are derived from other columns and unreadable outside Postgres. */
const DROPPED_COLUMNS = new Set(['search']);

export interface ExportFile {
  path: string;
  bytes: Uint8Array;
}

export interface ExportInput {
  exportedAt: Date;
  tables: Record<ExportTable, ExportRow[]>;
  /** Stored library files, by storage path. */
  files: ExportFile[];
  /** Storage paths that couldn't be read; listed in the manifest. */
  missingFiles: string[];
}

export function cleanRow(row: ExportRow): ExportRow {
  return Object.fromEntries(Object.entries(row).filter(([k]) => !DROPPED_COLUMNS.has(k)));
}

export function slugify(text: string): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug || 'untitled';
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length ? v : null;
}

/** notes/<course>/<lecture date>-<title>.md, unique within the zip. */
export function notePaths(notes: ExportRow[], courses: ExportRow[]): Map<string, string> {
  const courseDir = new Map(courses.map((c) => [String(c.id), slugify(String(c.code ?? c.slug ?? 'course'))]));
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const n of notes) {
    const dir = (n.course_id ? courseDir.get(String(n.course_id)) : null) ?? 'no-course';
    const date = str(n.lecture_on) ?? str(n.created_at)?.slice(0, 10) ?? 'undated';
    const base = `notes/${dir}/${date}-${slugify(str(n.title) ?? 'note')}`;
    let path = base;
    for (let i = 2; used.has(path); i++) path = `${base}-${i}`;
    used.add(path);
    out.set(String(n.id), path);
  }
  return out;
}

function readme(input: ExportInput, counts: Record<string, number>): string {
  const lines = [
    'Runway export',
    `Made ${input.exportedAt.toISOString()}.`,
    '',
    'runway.json    every row you own, one array per table (times are UTC, ISO 8601)',
    'notes/         each lecture note: <name>.md is what you pasted, <name>.cleaned.md is the',
    '               cleaned copy with your edits, when there is one',
    'files/         stored library files, by their storage path',
    '',
    'Rows per table:',
    ...EXPORT_TABLES.map((t) => `  ${t.padEnd(14)} ${counts[t]}`),
    '',
    'Not included: search chunks (rebuilt from notes and documents), the job queue, and',
    'connection tokens (Google, LEARN feed, calendar feed), which are secrets.',
  ];
  if (input.missingFiles.length) {
    lines.push('', 'These stored files could not be read:', ...input.missingFiles.map((p) => `  ${p}`));
  }
  return `${lines.join('\n')}\n`;
}

export function buildExportZip(input: ExportInput): Uint8Array {
  const tables = Object.fromEntries(EXPORT_TABLES.map((t) => [t, input.tables[t].map(cleanRow)])) as Record<ExportTable, ExportRow[]>;
  const counts = Object.fromEntries(EXPORT_TABLES.map((t) => [t, tables[t].length]));
  const json = {
    app: 'runway',
    format: 1,
    exported_at: input.exportedAt.toISOString(),
    counts,
    missing_files: input.missingFiles,
    tables,
  };

  const zip: Zippable = {
    'README.txt': strToU8(readme(input, counts)),
    'runway.json': strToU8(JSON.stringify(json, null, 2)),
  };
  const paths = notePaths(tables.notes, tables.courses);
  for (const n of tables.notes) {
    const path = paths.get(String(n.id))!;
    zip[`${path}.md`] = strToU8(String(n.original_md ?? ''));
    const cleaned = str(n.edited_md) ?? str(n.cleaned_md);
    if (cleaned) zip[`${path}.cleaned.md`] = strToU8(cleaned);
  }
  for (const f of input.files) {
    const safe = f.path.split('/').filter((p) => p && p !== '.' && p !== '..').join('/');
    if (safe) zip[`files/${safe}`] = [f.bytes, { level: 0 }];
  }
  return zipSync(zip, { level: 6, mtime: input.exportedAt });
}

/** runway-export-2026-09-23.zip, dated in Toronto. */
export function exportFileName(localDate: string): string {
  return `runway-export-${localDate}.zip`;
}
