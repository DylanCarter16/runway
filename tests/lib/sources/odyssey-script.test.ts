import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { parseOdyssey } from '@/lib/sources/odyssey';
import { buildOdysseyUserscript, odysseyEndpoint, odysseyPostSchema, tablesToText } from '@/lib/sources/odyssey-script';

// The Odyssey userscript and the cells it posts.

const TOKEN = 'a'.repeat(43);

/** The exam table as the script reads it: a header row, then one row per exam. */
const TABLE = [
  ['Course', 'Type', 'Date', 'Time', 'Location', 'Seat'],
  ['CS 251', 'Midterm', 'Thursday, November 12, 2026', '4:30 PM - 6:20 PM', 'PAC 7', '112'],
  ['STAT 230', 'Midterm 1', 'Thursday, October 8, 2026', '4:30 PM - 6:20 PM', 'M3 1006', 'TBA'],
];

describe('tablesToText', () => {
  it('gives the same tab-separated text a paste does, so the parser reads it by column', () => {
    const rows = parseOdyssey(tablesToText([TABLE]));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ courseCode: 'CS 251', kind: 'midterm', date: '2026-11-12', start: '16:30', end: '18:20', location: 'PAC 7', seat: '112' });
    expect(rows[1]).toMatchObject({ courseCode: 'STAT 230', date: '2026-10-08', location: 'M3 1006', seat: null });
  });

  it('squashes whitespace inside cells and drops empty rows and tables', () => {
    const text = tablesToText([[['  CS 251 ', 'Midterm\n'], ['', ' '], []], [], [['Help']]]);
    expect(text).toBe('CS 251\tMidterm\n\nHelp');
  });

  it('is the same for the same cells, so a repeat send is a duplicate', () => {
    expect(tablesToText([TABLE])).toBe(tablesToText([TABLE.map((r) => r.map((c) => ` ${c} `))]));
  });
});

describe('odysseyPostSchema', () => {
  it('accepts the tables and the page URL', () => {
    expect(odysseyPostSchema.safeParse({ tables: [TABLE], pageUrl: 'https://odyssey.uwaterloo.ca/teaching/schedule' }).success).toBe(true);
    expect(odysseyPostSchema.safeParse({ tables: [TABLE] }).success).toBe(true);
  });

  it('refuses no tables, wrong shapes, and oversized cells', () => {
    expect(odysseyPostSchema.safeParse({ tables: [] }).success).toBe(false);
    expect(odysseyPostSchema.safeParse({ tables: 'CS 251' }).success).toBe(false);
    expect(odysseyPostSchema.safeParse({ tables: [[[1, 2]]] }).success).toBe(false);
    expect(odysseyPostSchema.safeParse({ tables: [[['x'.repeat(501)]]] }).success).toBe(false);
    expect(odysseyPostSchema.safeParse({ tables: [TABLE], pageUrl: 'not a url' }).success).toBe(false);
  });
});

// A few DOM stand-ins, just enough for the script.
function fakeCell(text: string) {
  return { innerText: text, textContent: text };
}
function fakeTable(rows: string[][]) {
  return {
    querySelectorAll: () => rows.map((cells) => ({ querySelectorAll: () => cells.map(fakeCell) })),
  };
}

interface Sent {
  method: string;
  url: string;
  headers: Record<string, string>;
  data: string;
  onload: (res: { status: number; responseText: string }) => void;
  onerror: () => void;
}

function runScript(tables: string[][][]) {
  const sent: Sent[] = [];
  const shown: { text: string; bad: boolean }[] = [];
  const box = {
    style: { cssText: '', background: '', color: '' },
    title: '',
    textContent: '',
    setAttribute() {},
    addEventListener() {},
  };
  const context = {
    document: {
      querySelectorAll: (sel: string) => (sel === 'table' ? tables.map(fakeTable) : []),
      createElement: () => box,
      body: { appendChild() {} },
    },
    location: { href: 'https://odyssey.uwaterloo.ca/teaching/schedule' },
    setTimeout: (fn: () => void) => fn(),
    GM_xmlhttpRequest: (req: Sent) => sent.push(req),
  };
  const source = buildOdysseyUserscript('https://runway.test/', TOKEN);
  vm.runInNewContext(source, context);
  const read = () => {
    shown.push({ text: box.textContent, bad: box.style.color === '#8a1c1c' });
    return shown[shown.length - 1];
  };
  return { sent, read };
}

describe('buildOdysseyUserscript', () => {
  const source = buildOdysseyUserscript('https://runway.test/', TOKEN);

  it('has a userscript header for the Odyssey schedule page and Runway host only', () => {
    expect(source.startsWith('// ==UserScript==\n')).toBe(true);
    expect(source).toContain('// @match        https://odyssey.uwaterloo.ca/teaching/schedule*');
    expect(source).toContain('// @connect      runway.test\n');
    expect(source).toContain('// @grant        GM_xmlhttpRequest');
    expect(odysseyEndpoint('https://runway.test/')).toBe('https://runway.test/api/ingest/odyssey');
  });

  it('is valid JavaScript with the token as a string literal', () => {
    expect(() => new vm.Script(source)).not.toThrow();
    expect(source).toContain(`var TOKEN = "${TOKEN}";`);
  });

  it('posts every table cell with the token and shows the answer', () => {
    const { sent, read } = runScript([TABLE]);
    expect(sent).toHaveLength(1);
    expect(sent[0].method).toBe('POST');
    expect(sent[0].url).toBe('https://runway.test/api/ingest/odyssey');
    expect(sent[0].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    const body = JSON.parse(sent[0].data);
    expect(odysseyPostSchema.parse(body)).toEqual({ tables: [TABLE], pageUrl: 'https://odyssey.uwaterloo.ca/teaching/schedule' });
    expect(read().text).toBe('Runway: sending exam rows...');

    sent[0].onload({ status: 202, responseText: JSON.stringify({ message: 'sent 2 exam rows.' }) });
    expect(read()).toEqual({ text: 'Runway: sent 2 exam rows.', bad: false });
    sent[0].onload({ status: 401, responseText: 'Unauthorized' });
    expect(read()).toEqual({ text: 'Runway: the token was refused. Download the script again from Runway.', bad: true });
    sent[0].onerror();
    expect(read().bad).toBe(true);
  });

  it('sends nothing when the page has no table', () => {
    const { sent, read } = runScript([]);
    expect(sent).toHaveLength(0);
    expect(read()).toEqual({ text: 'Runway: no exam table on this page yet. Click to try again.', bad: true });
  });
});
