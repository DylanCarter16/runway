import { readFileSync } from 'node:fs';
import path from 'node:path';
import { emailBatchSchema, type EmailDocumentRow, type EmailStore } from '@/lib/sources/email';

// An in-memory documents table for the email ingest tests. It enforces the same
// unique indexes as the database: (user, kind, source_ref) for emails and
// (user, kind, content_hash).

export class MemoryEmailStore implements EmailStore {
  rows: (EmailDocumentRow & { id: string })[] = [];

  async knownIds(ids: string[]) {
    return new Set(this.rows.filter((r) => ids.includes(r.source_ref)).map((r) => r.source_ref));
  }

  async insert(row: EmailDocumentRow) {
    const clash = this.rows.some(
      (r) => r.user_id === row.user_id && r.kind === row.kind && (r.source_ref === row.source_ref || r.content_hash === row.content_hash),
    );
    if (clash) return null;
    const id = `doc-${this.rows.length + 1}`;
    this.rows.push({ ...row, id });
    return { id };
  }
}

export const NIDS = { stat230: 'xq1stat230demo', cs251: 'xq2cs251demo1', unmapped: 'xq3unmapped01' };

/** Two of the four classes mapped, as Dylan would in Settings, Courses. */
export const PIAZZA_MAP = { [NIDS.stat230]: 'stat230', [NIDS.cs251]: 'cs251' };

export const batchText = () => readFileSync(path.join(__dirname, '../../fixtures/email/piazza-batch.json'), 'utf8');
export const batch = () => emailBatchSchema.parse(JSON.parse(batchText()));
