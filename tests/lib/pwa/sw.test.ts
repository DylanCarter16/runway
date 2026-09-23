import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { beforeEach, describe, expect, it } from 'vitest';

// Runs public/sw.js in a vm with a fake network and Cache Storage.

const ORIGIN = 'https://runway.test';
const SOURCE = readFileSync(path.join(import.meta.dirname, '../../../public/sw.js'), 'utf8');

type Req = { url: string; method: string; mode: string };
type Handler = (event: unknown) => void;

function keyOf(r: string | Req | Request): string {
  return typeof r === 'string' ? new URL(r, ORIGIN).href : r.url;
}

class FakeCache {
  entries = new Map<string, Response>();
  constructor(private net: FakeNet) {}
  async match(r: string | Req) {
    return this.entries.get(keyOf(r))?.clone();
  }
  async put(r: string | Req, res: Response) {
    this.entries.set(keyOf(r), res);
  }
  async add(r: string) {
    await this.put(r, await this.net.fetch(r));
  }
  async keys() {
    return [...this.entries.keys()].map((u) => new Request(u));
  }
  async delete(r: string | Request) {
    return this.entries.delete(keyOf(r));
  }
}

class FakeStorage {
  stores = new Map<string, FakeCache>();
  constructor(private net: FakeNet) {}
  async open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache(this.net));
    return this.stores.get(name)!;
  }
  async match(r: string | Req) {
    for (const c of this.stores.values()) {
      const hit = await c.match(r);
      if (hit) return hit;
    }
    return undefined;
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
  paths(name: string): string[] {
    return [...(this.stores.get(name)?.entries.keys() ?? [])].map((u) => u.replace(ORIGIN, '')).sort();
  }
}

type Route = { status?: number; body?: string; redirected?: boolean };

class FakeNet {
  online = true;
  routes = new Map<string, Route>();
  calls: string[] = [];
  fetch = async (r: string | Req) => {
    const url = keyOf(r).replace(ORIGIN, '');
    this.calls.push(url);
    if (!this.online) throw new TypeError('Failed to fetch');
    const route = this.routes.get(url) ?? { status: 404, body: 'not found' };
    const res = new Response(route.body ?? '', { status: route.status ?? 200 });
    if (route.redirected) Object.defineProperty(res, 'redirected', { value: true });
    return res;
  };
}

function page(label: string, assets: string[]): string {
  const tags = assets.map((a) => (a.endsWith('.css') ? `<link rel="stylesheet" href="${a}">` : `<script src="${a}"></script>`));
  // Flight data escapes quotes, as in a real Next.js page.
  return `<html><head>${tags.join('')}</head><body>${label}<script>self.__next_f.push([1,"\\"${assets[0]}\\""])</script></body></html>`;
}

let net: FakeNet;
let storage: FakeStorage;
let handlers: Map<string, Handler>;

function boot() {
  net = new FakeNet();
  storage = new FakeStorage(net);
  handlers = new Map();
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: Handler) => handlers.set(type, fn),
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
  };
  vm.runInNewContext(SOURCE, { self, caches: storage, fetch: net.fetch, URL, Headers, Response, Request, Set, Promise, Date });
}

async function lifecycle(type: 'install' | 'activate') {
  let wait: Promise<unknown> = Promise.resolve();
  handlers.get(type)!({ waitUntil: (p: Promise<unknown>) => (wait = p) });
  await wait;
}

async function message(data: unknown) {
  let wait: Promise<unknown> = Promise.resolve();
  handlers.get('message')!({ data, waitUntil: (p: Promise<unknown>) => (wait = p) });
  await wait;
}

/** Dispatches a fetch event; `undefined` means the worker let the browser handle it. */
async function request(pathOrUrl: string, init: Partial<Req> = {}): Promise<Response | undefined> {
  const req: Req = { url: new URL(pathOrUrl, ORIGIN).href, method: 'GET', mode: 'navigate', ...init };
  let answer: Promise<Response> | undefined;
  handlers.get('fetch')!({ request: req, respondWith: (p: Promise<Response>) => (answer = p) });
  return answer ? await answer : undefined;
}

const PAGES = 'runway-pages-v1';
const STATIC = 'runway-static-v1';

beforeEach(async () => {
  boot();
  net.routes.set('/offline.html', { body: 'offline page' });
  net.routes.set('/', { body: page('Today', ['/_next/static/chunks/a.js', '/_next/static/css/app.css']) });
  net.routes.set('/calendar', { body: page('Calendar', ['/_next/static/chunks/a.js', '/_next/static/chunks/cal.js']) });
  net.routes.set('/calendar?course=cs251', { body: page('CS 251 calendar', ['/_next/static/chunks/a.js']) });
  net.routes.set('/notes', { body: page('Notes', ['/_next/static/chunks/a.js']) });
  for (const f of ['chunks/a.js', 'css/app.css', 'chunks/cal.js', 'chunks/old.js']) {
    net.routes.set(`/_next/static/${f}`, { body: `/* ${f} */` });
  }
  await lifecycle('install');
});

describe('install and activate', () => {
  it('saves the offline page on install', () => {
    expect(storage.paths(PAGES)).toEqual(['/offline.html']);
  });

  it('drops caches from older versions but not unrelated ones', async () => {
    await storage.open('runway-pages-v0');
    await storage.open('someone-else');
    await storage.open(STATIC);
    await lifecycle('activate');
    expect((await storage.keys()).sort()).toEqual([PAGES, STATIC, 'someone-else'].sort());
  });
});

describe('Today and Calendar', () => {
  it('serves the network copy online and saves it with its build files', async () => {
    const res = await request('/');
    // The live page is not marked as a saved copy.
    expect(await res!.text()).toMatch(/^<html><head>.*Today/);
    expect(storage.paths(PAGES)).toEqual(['/', '/offline.html']);
    expect(storage.paths(STATIC)).toEqual(['/_next/static/chunks/a.js', '/_next/static/css/app.css']);
  });

  it('serves the saved copy offline, marked with when it was saved', async () => {
    const before = Date.now();
    await request('/calendar');
    net.online = false;
    const res = await request('/calendar');
    const html = await res!.text();
    expect(html).toContain('Calendar');
    const stamp = /<html data-saved-copy="([^"]+)">/.exec(html)?.[1];
    expect(stamp).toBeDefined();
    expect(new Date(stamp!).getTime()).toBeGreaterThanOrEqual(before - 1000);
    // Its build files come from the cache too.
    const js = await request('/_next/static/chunks/cal.js', { mode: 'no-cors' });
    expect(await js!.text()).toContain('cal.js');
  });

  it('falls back to the offline page when nothing is saved', async () => {
    net.online = false;
    expect(await (await request('/'))!.text()).toBe('offline page');
  });

  it('never saves a redirect (signed out) or an error', async () => {
    net.routes.set('/', { body: 'login page', redirected: true });
    await request('/');
    net.routes.set('/calendar', { status: 500, body: 'boom' });
    await request('/calendar');
    expect(storage.paths(PAGES)).toEqual(['/offline.html']);
  });

  it('a filtered view uses the network but falls back to the plain saved page', async () => {
    await request('/calendar');
    const res = await request('/calendar?course=cs251');
    expect(await res!.text()).toContain('CS 251 calendar');
    const saved = await (await storage.open(PAGES)).match('/calendar');
    expect(await saved!.text()).toContain('>Calendar<');
    net.online = false;
    expect(await (await request('/calendar?course=cs251'))!.text()).toContain('>Calendar<');
  });
});

describe('other requests', () => {
  it('other pages use the network and are never saved', async () => {
    expect(await (await request('/notes'))!.text()).toContain('Notes');
    expect(storage.paths(PAGES)).toEqual(['/offline.html']);
    net.online = false;
    expect(await (await request('/notes'))!.text()).toBe('offline page');
  });

  it('leaves data fetches, posts, and other origins to the browser', async () => {
    expect(await request('/calendar?_rsc=abc', { mode: 'cors' })).toBeUndefined();
    expect(await request('/', { method: 'POST' })).toBeUndefined();
    expect(await request('https://example.supabase.co/rest/v1/items')).toBeUndefined();
  });

  it('build files are cache first', async () => {
    await request('/_next/static/chunks/a.js', { mode: 'no-cors' });
    net.calls = [];
    const res = await request('/_next/static/chunks/a.js', { mode: 'no-cors' });
    expect(await res!.text()).toContain('a.js');
    expect(net.calls).toEqual([]);
  });
});

describe('warm', () => {
  it('saves Today and Calendar and drops build files neither names', async () => {
    await request('/_next/static/chunks/old.js', { mode: 'no-cors' });
    await message({ type: 'warm' });
    expect(storage.paths(PAGES)).toEqual(['/', '/calendar', '/offline.html']);
    expect(storage.paths(STATIC)).toEqual([
      '/_next/static/chunks/a.js',
      '/_next/static/chunks/cal.js',
      '/_next/static/css/app.css',
    ]);
  });

  it('keeps everything when a page could not be fetched', async () => {
    await request('/_next/static/chunks/old.js', { mode: 'no-cors' });
    net.routes.set('/calendar', { body: 'login page', redirected: true });
    await message({ type: 'warm' });
    expect(storage.paths(STATIC)).toContain('/_next/static/chunks/old.js');
    expect(storage.paths(PAGES)).toEqual(['/', '/offline.html']);
  });

  it('ignores unknown messages', async () => {
    await message({ type: 'nope' });
    expect(storage.paths(PAGES)).toEqual(['/offline.html']);
  });
});
