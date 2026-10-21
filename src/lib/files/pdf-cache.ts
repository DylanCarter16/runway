// The PDF viewer's bytes, kept for the browser session (2026-10-20, storage egress).
//
// Before: the viewer handed pdf.js a signed URL, and the Library page made a new one on every
// render. While a file was being read the page refreshed every 4 seconds, so every refresh
// gave react-pdf a new URL and it downloaded the whole PDF again, for as long as the tab
// stayed open. Now the viewer asks for a link once per file per session (viewerFileUrl),
// pdf.js reads the file through a PDFDataRangeTransport in RANGE_CHUNK pieces as pages
// need them (HTTP Range requests, so a page jump fetches only what that page uses), and
// every piece is kept here, so no byte of a file is fetched twice in a session, whatever
// the page does: refresh, page jumps, zoom, search, or leaving and coming back.
//
// Framework-free so tests can drive it with real pdf.js in Node (tests/lib/files/pdf-cache.test.ts).

/** How long the viewer's link lasts. A link that expires mid-read is replaced once. */
export const VIEWER_URL_SECONDS = 3600;

/** pdf.js asks for ranges in multiples of its rangeChunkSize; the cache keeps pieces this big. */
export const RANGE_CHUNK = 128 * 1024;

/** Files kept in memory at once (each up to 50 MB); the least recently opened goes first. */
export const MAX_CACHED_FILES = 4;

export interface FileLink {
  url: string;
  size: number | null;
}

export type GetLink = (documentId: string) => Promise<FileLink>;

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** One file's bytes for the session, fetched by range on demand and never twice. */
export class CachedFile {
  readonly documentId: string;
  /** Total length; null until known (a file with no stored size is fetched whole once). */
  size: number | null;
  /** Network requests made for this file's bytes. */
  requests = 0;
  /** Links asked for (each one is a counted storage read on the server). */
  links = 1;
  private chunks = new Map<number, Uint8Array>();
  private pending = new Map<number, Promise<void>>();
  private url: string;
  private whole: Promise<void> | null = null;

  constructor(
    documentId: string,
    link: FileLink,
    private getLink: GetLink,
    private fetchImpl: Fetch,
  ) {
    this.documentId = documentId;
    this.url = link.url;
    this.size = link.size && link.size > 0 ? link.size : null;
  }

  /** Bytes fetched so far. */
  get cachedBytes(): number {
    let n = 0;
    for (const c of this.chunks.values()) n += c.length;
    return n;
  }

  private chunkCount(): number {
    return Math.ceil((this.size ?? 0) / RANGE_CHUNK);
  }

  /** GET with one retry on a fresh link when the old one expired. */
  private async get(range: string | null): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      this.requests++;
      const res = await this.fetchImpl(this.url, range ? { headers: { Range: range } } : undefined);
      if (res.ok) return res;
      if (attempt === 0 && (res.status === 400 || res.status === 401 || res.status === 403)) {
        this.links++;
        this.url = (await this.getLink(this.documentId)).url;
        continue;
      }
      throw new Error(`The file could not be read (HTTP ${res.status}).`);
    }
  }

  /** Stores a run of bytes that starts at a chunk boundary. */
  private keep(start: number, bytes: Uint8Array) {
    for (let at = 0; at < bytes.length; at += RANGE_CHUNK) this.chunks.set((start + at) / RANGE_CHUNK, bytes.slice(at, at + RANGE_CHUNK));
  }

  /** The whole file in one request: when the size is unknown, or the server ignored Range. */
  private fetchWhole(): Promise<void> {
    this.whole ??= (async () => {
      const bytes = new Uint8Array(await (await this.get(null)).arrayBuffer());
      this.size = bytes.length;
      this.keep(0, bytes);
    })();
    return this.whole;
  }

  /** Fetches chunks [first, last] in one Range request. */
  private async fetchRun(first: number, last: number): Promise<void> {
    const start = first * RANGE_CHUNK;
    const end = Math.min((last + 1) * RANGE_CHUNK, this.size!) - 1;
    const res = await this.get(`bytes=${start}-${end}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (res.status === 206) this.keep(start, bytes);
    else {
      // A 200 is the whole file: keep all of it, so nothing is asked for again.
      this.size = bytes.length;
      this.keep(0, bytes);
      this.whole = Promise.resolve();
    }
  }

  /** Makes sure chunks [first, last] are here, fetching each missing run once. */
  private async ensure(first: number, last: number): Promise<void> {
    const waits: Promise<void>[] = [];
    let runStart = -1;
    const flush = (end: number) => {
      if (runStart < 0) return;
      const start = runStart;
      runStart = -1;
      if (end < start) return;
      const run = this.fetchRun(start, end);
      for (let i = start; i <= end; i++) this.pending.set(i, run);
      const done = () => {
        for (let i = start; i <= end; i++) if (this.pending.get(i) === run) this.pending.delete(i);
      };
      run.then(done, done);
      waits.push(run);
    };
    for (let i = first; i <= last; i++) {
      const inFlight = this.pending.get(i);
      if (this.chunks.has(i) || inFlight) {
        flush(i - 1);
        if (inFlight) waits.push(inFlight);
        continue;
      }
      if (runStart < 0) runStart = i;
    }
    flush(last);
    await Promise.all(waits);
  }

  /** Bytes [begin, end) of the file. */
  async read(begin: number, end: number): Promise<Uint8Array> {
    if (this.size === null) await this.fetchWhole();
    const stop = Math.min(end, this.size!);
    if (stop <= begin) return new Uint8Array(0);
    const first = Math.floor(begin / RANGE_CHUNK);
    const last = Math.floor((stop - 1) / RANGE_CHUNK);
    if (!this.whole) await this.ensure(first, last);
    else await this.whole;
    const out = new Uint8Array(stop - begin);
    for (let i = first; i <= last; i++) {
      const chunk = this.chunks.get(i);
      if (!chunk) throw new Error('A piece of the file is missing.');
      const chunkStart = i * RANGE_CHUNK;
      const from = Math.max(begin, chunkStart) - chunkStart;
      const to = Math.min(stop, chunkStart + chunk.length) - chunkStart;
      out.set(chunk.subarray(from, to), chunkStart + from - begin);
    }
    return out;
  }

  /** True once every byte is here. */
  get complete(): boolean {
    return this.size !== null && this.chunks.size === this.chunkCount();
  }
}

const files = new Map<string, Promise<CachedFile>>();

/**
 * The session's copy of a file: the first call asks for a link, later calls (a refresh, a
 * remount, a new signed URL in the page) get the same bytes with no request at all.
 */
export function openCachedFile(documentId: string, getLink: GetLink, fetchImpl: Fetch = (u, i) => fetch(u, i)): Promise<CachedFile> {
  let file = files.get(documentId);
  if (file) {
    // Most recently opened goes to the back of the line.
    files.delete(documentId);
    files.set(documentId, file);
    return file;
  }
  file = getLink(documentId).then((link) => new CachedFile(documentId, link, getLink, fetchImpl));
  file.catch(() => files.delete(documentId));
  files.set(documentId, file);
  while (files.size > MAX_CACHED_FILES) files.delete(files.keys().next().value!);
  return file;
}

/** Tests: forget every file. */
export function clearPdfCache() {
  files.clear();
}

/** The parts of pdf.js's PDFDataRangeTransport the viewer uses. */
export interface RangeTransport {
  requestDataRange(begin: number, end: number): void;
  onDataRange(begin: number, chunk: Uint8Array): void;
  abort(): void;
}

type RangeTransportClass<T extends RangeTransport> = new (length: number, initialData: Uint8Array | null, progressiveDone?: boolean) => T;

/**
 * A pdf.js range transport over a cached file. Pass the PDFDataRangeTransport class from the
 * same pdf.js the viewer uses (react-pdf's `pdfjs`). A new transport per load is fine: the
 * bytes live in the CachedFile. pdf.js must be given `rangeChunkSize: RANGE_CHUNK` and
 * `disableAutoFetch: true` so it asks only for what the pages on screen need.
 */
export async function rangeTransportFor<T extends RangeTransport>(Base: RangeTransportClass<T>, file: CachedFile, onError: (e: Error) => void): Promise<T> {
  if (file.size === null) await file.read(0, 1); // unknown length: fetched whole, once
  const transport = new Base(file.size!, null, false);
  let aborted = false;
  transport.requestDataRange = (begin: number, end: number) => {
    file.read(begin, end).then(
      (bytes) => {
        if (!aborted) transport.onDataRange(begin, bytes);
      },
      (e: unknown) => {
        if (!aborted) onError(e instanceof Error ? e : new Error(String(e)));
      },
    );
  };
  const abort = transport.abort.bind(transport);
  transport.abort = () => {
    aborted = true;
    abort();
  };
  return transport;
}

/** pdf.js options that go with rangeTransportFor. Keep one object so react-pdf never reloads on a new one. */
export const PDF_RANGE_OPTIONS = { rangeChunkSize: RANGE_CHUNK, disableAutoFetch: true, disableStream: true } as const;
