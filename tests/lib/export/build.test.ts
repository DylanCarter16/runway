import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildExportZip, EXPORT_TABLES, exportFileName, notePaths, slugify, type ExportInput, type ExportRow, type ExportTable } from '@/lib/export/build';

function emptyTables(): Record<ExportTable, ExportRow[]> {
  return Object.fromEntries(EXPORT_TABLES.map((t) => [t, []])) as unknown as Record<ExportTable, ExportRow[]>;
}

function input(over: Partial<Record<ExportTable, ExportRow[]>> = {}, rest: Partial<ExportInput> = {}): ExportInput {
  return {
    exportedAt: new Date('2026-09-23T16:00:00Z'),
    tables: { ...emptyTables(), ...over },
    files: [],
    missingFiles: [],
    ...rest,
  };
}

const STAT = { id: 'c-stat', code: 'STAT 230', slug: 'stat230' };
const CS = { id: 'c-cs', code: 'CS 251', slug: 'cs251' };

describe('slugify', () => {
  it('keeps letters and digits, joined by dashes', () => {
    expect(slugify('Lecture 5: Independence & Bayes’ rule')).toBe('lecture-5-independence-bayes-rule');
    expect(slugify('Café résumé')).toBe('cafe-resume');
    expect(slugify('  ***  ')).toBe('untitled');
  });

  it('caps the length without a trailing dash', () => {
    const s = slugify(`${'a'.repeat(59)} b`);
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s.endsWith('-')).toBe(false);
  });
});

describe('notePaths', () => {
  it('files notes by course and lecture date, and never reuses a path', () => {
    const notes = [
      { id: 'n1', course_id: 'c-stat', lecture_on: '2026-09-21', title: 'Independence', created_at: '2026-09-21T20:00:00Z' },
      { id: 'n2', course_id: 'c-stat', lecture_on: '2026-09-21', title: 'Independence', created_at: '2026-09-21T21:00:00Z' },
      { id: 'n3', course_id: null, lecture_on: null, title: null, created_at: '2026-09-22T01:00:00Z' },
    ];
    const paths = notePaths(notes, [STAT, CS]);
    expect(paths.get('n1')).toBe('notes/stat-230/2026-09-21-independence');
    expect(paths.get('n2')).toBe('notes/stat-230/2026-09-21-independence-2');
    expect(paths.get('n3')).toBe('notes/no-course/2026-09-22-note');
  });
});

describe('buildExportZip', () => {
  const original = '# Lecture 5\n\nP(A ∩ B) = P(A)P(B)  $$\\sum_i p_i = 1$$\n';
  const zipped = buildExportZip(
    input(
      {
        courses: [STAT, CS],
        items: [{ id: 'i1', title: 'A1', due_at: '2026-10-02T02:00:00Z', search: "'a1':1" }],
        notes: [
          { id: 'n1', course_id: 'c-stat', lecture_on: '2026-09-21', title: 'Independence', original_md: original, cleaned_md: 'cleaned', edited_md: 'edited', search: 'x' },
          { id: 'n2', course_id: 'c-cs', lecture_on: '2026-09-22', title: 'Heaps', original_md: 'mine only', cleaned_md: null, edited_md: null },
        ],
        documents: [{ id: 'd1', title: 'Outline', raw_text: 'raw', storage_path: 'u1/outline.pdf', search: 'y' }],
        settings: [{ user_id: 'u1', study_block_hour: 19 }],
      },
      {
        files: [
          { path: 'u1/outline.pdf', bytes: new Uint8Array([37, 80, 68, 70]) },
          { path: '../../etc/passwd', bytes: new Uint8Array([1]) },
        ],
        missingFiles: ['u1/gone.pdf'],
      },
    ),
  );
  const files = unzipSync(zipped);
  const json = JSON.parse(strFromU8(files['runway.json']));

  it('has every table, with counts, and no search vectors', () => {
    expect(Object.keys(json.tables)).toEqual([...EXPORT_TABLES]);
    expect(json.exported_at).toBe('2026-09-23T16:00:00.000Z');
    expect(json.counts.notes).toBe(2);
    expect(json.counts.jobs).toBeUndefined();
    expect(json.tables.items[0]).toEqual({ id: 'i1', title: 'A1', due_at: '2026-10-02T02:00:00Z' });
    expect(json.tables.documents[0].search).toBeUndefined();
    expect(json.missing_files).toEqual(['u1/gone.pdf']);
  });

  it('never includes secrets or server-only tables', () => {
    expect(EXPORT_TABLES).not.toContain('integration_tokens');
    expect(EXPORT_TABLES).not.toContain('jobs');
    expect(Object.keys(json.tables)).not.toContain('integration_tokens');
  });

  it('writes each note byte for byte, plus the edited copy when there is one', () => {
    expect(strFromU8(files['notes/stat-230/2026-09-21-independence.md'])).toBe(original);
    expect(strFromU8(files['notes/stat-230/2026-09-21-independence.cleaned.md'])).toBe('edited');
    expect(strFromU8(files['notes/cs-251/2026-09-22-heaps.md'])).toBe('mine only');
    expect(files['notes/cs-251/2026-09-22-heaps.cleaned.md']).toBeUndefined();
  });

  it('stores library files under files/ and drops path tricks', () => {
    expect([...files['files/u1/outline.pdf']]).toEqual([37, 80, 68, 70]);
    expect(Object.keys(files).some((k) => k.includes('..'))).toBe(false);
    expect(files['files/etc/passwd']).toBeDefined();
  });

  it('explains the contents and lists unreadable files in the README', () => {
    const readme = strFromU8(files['README.txt']);
    expect(readme).toContain('runway.json');
    expect(readme).toMatch(/notes\s+2/);
    expect(readme).toContain('u1/gone.pdf');
  });

  it('works with nothing stored', () => {
    const empty = unzipSync(buildExportZip(input()));
    expect(Object.keys(empty).sort()).toEqual(['README.txt', 'runway.json']);
  });
});

describe('exportFileName', () => {
  it('is dated', () => {
    expect(exportFileName('2026-09-23')).toBe('runway-export-2026-09-23.zip');
  });
});
