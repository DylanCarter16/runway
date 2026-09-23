import { z } from 'zod';

// Odyssey userscript (Phase 8, docs/SOURCES.md section 8). Odyssey sits behind
// WatIAM and Duo, so Runway never fetches it. Instead a Tampermonkey script runs
// in Dylan's own signed-in browser, reads the exam tables' cells, and posts them
// to POST /api/ingest/odyssey with a personal token. The server turns the cells
// into the same tab-separated text a paste gives, so the rule-based parser reads
// both. Pure and client-safe: Settings builds the script in the browser.

export const ODYSSEY_PAGE = 'https://odyssey.uwaterloo.ca/teaching/schedule';
export const ODYSSEY_SCRIPT_FILE = 'runway-odyssey.user.js';

const cell = z.string().max(500);
/** Cells per table per row. Generous limits; the real page has a handful of rows. */
export const odysseyPostSchema = z.object({
  tables: z
    .array(z.array(z.array(cell).max(30)).max(200))
    .min(1)
    .max(20),
  pageUrl: z.url().max(500).nullish(),
});

export type OdysseyPost = z.infer<typeof odysseyPostSchema>;

/** One row per line, cells joined by tabs (header rows included), a blank line between tables. */
export function tablesToText(tables: string[][][]): string {
  return tables
    .map((rows) =>
      rows
        .map((cells) => cells.map((c) => c.replace(/\s+/g, ' ').trim()).join('\t'))
        .filter((line) => line.replace(/\t/g, '').trim())
        .join('\n'),
    )
    .filter(Boolean)
    .join('\n\n');
}

/** `/api/ingest/odyssey` on the app's origin. */
export function odysseyEndpoint(appUrl: string): string {
  return `${appUrl.replace(/\/$/, '')}/api/ingest/odyssey`;
}

/**
 * The userscript with the endpoint and token filled in. Plain ES5 so it runs in
 * any userscript manager. GM_xmlhttpRequest skips CORS, and @connect limits it to
 * Runway's host.
 */
export function buildOdysseyUserscript(appUrl: string, token: string): string {
  const endpoint = odysseyEndpoint(appUrl);
  const host = new URL(endpoint).hostname;
  return `// ==UserScript==
// @name         Runway: Odyssey exams
// @namespace    runway
// @version      1
// @description  Sends your exam rows (date, time, room, seat) from Odyssey to Runway.
// @match        ${ODYSSEY_PAGE}*
// @grant        GM_xmlhttpRequest
// @connect      ${host}
// @run-at       document-idle
// ==/UserScript==

// The token below lets this script add exam rows to your Runway inbox. Keep it
// private; make a new one in Runway (Settings, Integrations) if it leaks.
(function () {
  'use strict';
  var ENDPOINT = ${JSON.stringify(endpoint)};
  var TOKEN = ${JSON.stringify(token)};
  var box = null;

  function cellText(c) {
    return (c.innerText || c.textContent || '').replace(/\\s+/g, ' ').trim();
  }

  function readTables() {
    var tables = [];
    Array.prototype.forEach.call(document.querySelectorAll('table'), function (table) {
      var rows = [];
      Array.prototype.forEach.call(table.querySelectorAll('tr'), function (tr) {
        var cells = Array.prototype.map.call(tr.querySelectorAll('th, td'), cellText);
        if (cells.join('')) rows.push(cells.slice(0, 30));
      });
      if (rows.length) tables.push(rows.slice(0, 200));
    });
    return tables.slice(0, 20);
  }

  function show(text, bad) {
    if (!box) {
      box = document.createElement('div');
      box.setAttribute('role', 'status');
      box.style.cssText =
        'position:fixed;right:12px;bottom:12px;z-index:99999;max-width:320px;padding:10px 12px;border-radius:8px;' +
        'font:14px/1.4 system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.25);cursor:pointer;';
      box.title = 'Send to Runway again';
      box.addEventListener('click', send);
      document.body.appendChild(box);
    }
    box.textContent = text;
    box.style.background = bad ? '#fde8e8' : '#ffffff';
    box.style.color = bad ? '#8a1c1c' : '#111111';
  }

  function send() {
    var tables = readTables();
    if (!tables.length) {
      show('Runway: no exam table on this page yet. Click to try again.', true);
      return;
    }
    show('Runway: sending exam rows...');
    GM_xmlhttpRequest({
      method: 'POST',
      url: ENDPOINT,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
      data: JSON.stringify({ tables: tables, pageUrl: location.href }),
      timeout: 20000,
      onload: function (res) {
        var body = {};
        try {
          body = JSON.parse(res.responseText);
        } catch (e) {}
        var fallback = res.status === 401 ? 'the token was refused. Download the script again from Runway.' : 'error ' + res.status + '.';
        show('Runway: ' + (body.message || fallback), res.status >= 400);
      },
      onerror: function () {
        show('Runway: could not reach Runway. Click to try again.', true);
      },
      ontimeout: function () {
        show('Runway: no answer from Runway. Click to try again.', true);
      },
    });
  }

  // Odyssey fills its table after the page loads, so wait a moment first.
  setTimeout(send, 1500);
})();
`;
}
