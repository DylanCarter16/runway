// Polite HTTP for every source (docs/SOURCES.md section 4): a User-Agent naming the
// app, conditional GET with ETag and Last-Modified, a 10 second timeout, no retries.
// Error messages name the host only, because some URLs (the LEARN feed) hold a token.

export interface FetchOptions {
  userAgent: string;
  etag?: string | null;
  lastModified?: string | null;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface FetchResult {
  status: number;
  ok: boolean;
  notModified: boolean;
  body: string;
  etag: string | null;
  lastModified: string | null;
}

export class FetchError extends Error {}

export function runwayUserAgent(contact: string): string {
  return `Runway/1.0 (personal course tracker; contact: ${contact})`;
}

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'the server';
  }
}

export async function politeFetch(url: string, opts: FetchOptions): Promise<FetchResult> {
  const headers: Record<string, string> = { 'user-agent': opts.userAgent, ...opts.headers };
  if (opts.etag) headers['if-none-match'] = opts.etag;
  if (opts.lastModified) headers['if-modified-since'] = opts.lastModified;

  let res: Response;
  try {
    res = await fetch(url, { headers, redirect: 'follow', cache: 'no-store', signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000) });
  } catch (e) {
    const reason = e instanceof Error && e.name === 'TimeoutError' ? 'no answer within 10 seconds' : 'the connection failed';
    throw new FetchError(`Could not reach ${host(url)}: ${reason}.`);
  }
  const notModified = res.status === 304;
  return {
    status: res.status,
    ok: res.ok,
    notModified,
    body: notModified ? '' : await res.text(),
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
  };
}
