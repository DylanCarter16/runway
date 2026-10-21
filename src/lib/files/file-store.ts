import type { FileDoc, FileStore } from './process';
import { StorageReadLimitError } from './storage-reads';

// Reading a stored file inside a job step (2026-10-20, storage egress). A step downloads the
// file at most once, and a failure to get or open the whole file is a WholeFileError, which
// ends the file instead of moving to the next page and downloading it all again.

/**
 * The file as a whole could not be fetched or read (storage, a PDF that won't open, pages
 * that won't save). Retrying the next page would only download it again, so the job ends
 * the file as failed after its last try. `retry` is false past the daily read cap.
 */
export class WholeFileError extends Error {
  retry: boolean;
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'WholeFileError';
    this.retry = !(cause instanceof StorageReadLimitError);
  }
}

export function wholeFile(e: unknown, what: string): WholeFileError {
  if (e instanceof WholeFileError) return e;
  if (e instanceof StorageReadLimitError) return new WholeFileError(e.message, e);
  return new WholeFileError(`${what}: ${e instanceof Error ? e.message : String(e)}`, e);
}

/** The stored file, as a WholeFileError when it can't be had. */
export async function downloadFile(store: FileStore, doc: FileDoc): Promise<Uint8Array> {
  if (!doc.storage_path) throw new WholeFileError('This document has no stored file.');
  try {
    return await store.download(doc);
  } catch (e) {
    throw wholeFile(e, 'Could not download the file');
  }
}

const stepStores = new WeakSet<FileStore>();

/**
 * The store for one job step: the file is downloaded at most once however many parts of
 * the step need it (plan, transcribe, index, outline). Each caller gets its own copy,
 * since pdf.js may detach the buffer it is handed.
 */
export function stepStore(store: FileStore): FileStore {
  if (stepStores.has(store)) return store;
  const fetched = new Map<string, Promise<Uint8Array>>();
  const wrapped: FileStore = {
    document: (id, userId) => store.document(id, userId),
    download(doc) {
      const key = doc.storage_path ?? doc.id;
      let bytes = fetched.get(key);
      if (!bytes) {
        bytes = store.download(doc);
        fetched.set(key, bytes);
        bytes.catch(() => fetched.delete(key));
      }
      return bytes.then((b) => new Uint8Array(b));
    },
    courses: (userId) => store.courses(userId),
    pages: (documentId) => store.pages(documentId),
    savePages: (doc, rows) => store.savePages(doc, rows),
    updatePage: (id, patch) => store.updatePage(id, patch),
    knownPages: (userId, courseId, exceptDocumentId) => store.knownPages(userId, courseId, exceptDocumentId),
    updateMeta: (doc, meta) => store.updateMeta(doc, meta),
  };
  stepStores.add(wrapped);
  return wrapped;
}
