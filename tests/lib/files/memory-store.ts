import type { KnownPage, PlannedPage } from '@/lib/files/plan';
import type { CourseRow, FileDoc, FileMeta, FileStore, StoredPage } from '@/lib/files/process';

/** FileStore in memory: files by storage path, pages by document. Counts downloads. */
export class MemoryFileStore implements FileStore {
  docs = new Map<string, FileDoc>();
  files = new Map<string, Uint8Array>();
  rows = new Map<string, StoredPage & { document_id: string; user_id: string; course_id: string | null }>();
  downloads = 0;
  private nextId = 1;

  constructor(public courseRows: CourseRow[]) {}

  addFile(doc: FileDoc, bytes: Uint8Array) {
    this.docs.set(doc.id, doc);
    this.files.set(doc.storage_path!, bytes);
  }

  async document(id: string, userId: string) {
    const d = this.docs.get(id);
    return d && d.user_id === userId ? structuredClone(d) : null;
  }

  async download(doc: Pick<FileDoc, 'id' | 'storage_path'>) {
    this.downloads++;
    const f = this.files.get(doc.storage_path ?? '');
    if (!f) throw new Error(`No file at ${doc.storage_path}`);
    return new Uint8Array(f);
  }

  async courses() {
    return this.courseRows;
  }

  async pages(documentId: string) {
    return [...this.rows.values()].filter((r) => r.document_id === documentId).map((r) => ({ ...r }));
  }

  async savePages(doc: FileDoc, planned: PlannedPage[]) {
    for (const p of planned) {
      const existing = [...this.rows.values()].find((r) => r.document_id === doc.id && r.page === p.page);
      const id = existing?.id ?? `page-${this.nextId++}`;
      this.rows.set(id, { id, document_id: doc.id, user_id: doc.user_id, course_id: doc.course_id, page: p.page, status: p.status, method: p.method, text: p.text, reason: p.reason, fingerprint: p.fingerprint, headings: p.headings ?? existing?.headings ?? null });
    }
  }

  async updatePage(id: string, patch: Partial<StoredPage>) {
    const r = this.rows.get(id);
    if (r) this.rows.set(id, { ...r, ...patch });
  }

  async knownPages(userId: string, courseId: string | null, exceptDocumentId: string) {
    const known = new Map<string, KnownPage>();
    for (const r of this.rows.values()) {
      if (r.user_id !== userId || r.course_id !== courseId || r.document_id === exceptDocumentId) continue;
      if (r.fingerprint && (r.status === 'done' || r.status === 'already_stored')) known.set(r.fingerprint, { id: r.id, text: r.text });
    }
    return known;
  }

  async updateMeta(doc: FileDoc, meta: FileMeta) {
    const d = this.docs.get(doc.id);
    if (d) d.meta = structuredClone(meta);
  }
}
