// Runway service worker: an offline shell for Today and Calendar.
// Today and Calendar are network first; the last good copy is kept for when the phone is
// offline. Build files under /_next/static are content-hashed, so they are cache first.
// Every other request goes straight to the network, and other pages fall back to
// /offline.html when there is none. tests/lib/pwa/sw.test.ts runs this file in a vm.

const VERSION = 'v1';
const PAGES = `runway-pages-${VERSION}`;
const STATIC = `runway-static-${VERSION}`;
const SHELL_PATHS = ['/', '/calendar'];
const OFFLINE_URL = '/offline.html';
const STATIC_PREFIX = '/_next/static/';
const SAVED_AT_HEADER = 'x-runway-saved-at';

function isShellPath(pathname) {
  return SHELL_PATHS.includes(pathname);
}

/** Build-file URLs named in a page's HTML (scripts, styles, fonts), same origin only. */
function staticUrls(html) {
  const found = new Set();
  const re = /\/_next\/static\/[^"'\s)\\]+/g;
  let m;
  while ((m = re.exec(html))) found.add(m[0]);
  return [...found];
}

/** A response worth keeping: a 200 that was not a redirect (a redirect means signed out). */
function keepable(res) {
  return Boolean(res) && res.ok && res.status === 200 && !res.redirected && res.type !== 'opaque';
}

async function cacheStatic(urls) {
  const cache = await caches.open(STATIC);
  await Promise.all(
    urls.map(async (url) => {
      if (await cache.match(url)) return;
      try {
        const res = await fetch(url);
        if (keepable(res)) await cache.put(url, res);
      } catch {
        // Offline or gone; the next visit tries again.
      }
    }),
  );
}

/** Saves a shell page, stamped with when it was saved, and the build files it needs; returns their URLs. */
async function savePage(pathname, res) {
  const html = await res.text();
  const headers = new Headers(res.headers);
  headers.set(SAVED_AT_HEADER, new Date().toISOString());
  const cache = await caches.open(PAGES);
  await cache.put(pathname, new Response(html, { status: 200, headers }));
  const urls = staticUrls(html);
  await cacheStatic(urls);
  return urls;
}

/**
 * The saved copy of a page, with `data-saved-copy="<when saved>"` on its <html> tag so the
 * offline banner can say how old it is. The root layout suppresses hydration warnings there.
 */
async function savedPage(pathname) {
  const cache = await caches.open(PAGES);
  const hit = await cache.match(pathname);
  if (!hit) return undefined;
  const savedAt = hit.headers.get(SAVED_AT_HEADER) || '';
  const html = (await hit.text()).replace(/<html(\s|>)/, `<html data-saved-copy="${savedAt}"$1`);
  return new Response(html, { status: 200, headers: hit.headers });
}

async function shellPage(request, pathname, save) {
  try {
    const res = await fetch(request);
    if (save && keepable(res)) await savePage(pathname, res.clone());
    return res;
  } catch {
    return (await savedPage(pathname)) || (await caches.match(OFFLINE_URL)) || Response.error();
  }
}

async function otherPage(request) {
  try {
    return await fetch(request);
  } catch {
    return (await caches.match(OFFLINE_URL)) || Response.error();
  }
}

async function staticFile(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (keepable(res)) await cache.put(request, res.clone());
  return res;
}

/**
 * Fetches Today and Calendar in the background so both work offline before a visit, then
 * drops build files neither page names (old deploys), so the cache stays one build big.
 */
async function warm() {
  const needed = await Promise.all(
    SHELL_PATHS.map(async (pathname) => {
      try {
        const res = await fetch(pathname, { credentials: 'same-origin' });
        if (!keepable(res)) return null;
        return await savePage(pathname, res);
      } catch {
        return null; // Offline; try again on the next load.
      }
    }),
  );
  if (needed.some((urls) => urls === null)) return;
  const keep = new Set(needed.flat());
  const cache = await caches.open(STATIC);
  for (const request of await cache.keys()) {
    const { pathname, search } = new URL(request.url);
    if (!keep.has(pathname + search)) await cache.delete(request);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(PAGES)
      .then((cache) => cache.add(OFFLINE_URL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith('runway-') && k !== PAGES && k !== STATIC).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type;
  if (type === 'warm') event.waitUntil(warm());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith(STATIC_PREFIX)) {
    event.respondWith(staticFile(request));
    return;
  }
  if (request.mode !== 'navigate') return;
  if (isShellPath(url.pathname)) {
    // Filtered views (?course=) fall back to the plain page but don't replace it.
    event.respondWith(shellPage(request, url.pathname, !url.search));
    return;
  }
  event.respondWith(otherPage(request));
});
