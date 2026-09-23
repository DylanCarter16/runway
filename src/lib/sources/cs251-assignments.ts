import { absoluteUrl, clock, isoDate, loadPage, monthNumber, squish } from './html';
import type { PageContext } from './cs251-schedule';
import type { ParsedEvent } from './types';

// CS 251 assignments page (docs/SOURCES.md section 3b), the only CS 251 page with
// due times. A <s> element holds a replaced date: its text is dropped and the row
// gets the date_changed flag.

const DUE =
  /(?:[A-Za-z]+day,?\s+)?([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?(?:[^0-9]*?(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?))?/i;

/** "Wednesday September 30 — 10:00 pm" → date and time. */
export function parseDueCell(text: string, termYear: number): { date: string; time: string | null } | null {
  const m = DUE.exec(text);
  if (!m) return null;
  const month = monthNumber(m[1]);
  if (!month) return null;
  const date = isoDate(m[3] ? Number(m[3]) : termYear, month, Number(m[2]));
  const time = m[4] ? clock(m[4], m[5], m[6]) : null;
  return { date, time };
}

export function parseCs251Assignments(html: string, ctx: PageContext): ParsedEvent[] {
  const $ = loadPage(html);
  const table = $('table').first();
  const events: ParsedEvent[] = [];

  for (const row of table.find('tr').toArray()) {
    const cells = $(row).children('td');
    if (cells.length < 2) continue;
    const name = /^Assignment\s+(\d+)\b/i.exec(squish(cells.eq(0).text()));
    if (!name) continue;

    const dueCell = cells.eq(1).clone();
    const changed = dueCell.find('s, strike, del').length > 0;
    dueCell.find('s, strike, del').remove();
    const dueText = squish(dueCell.text());
    if (!dueText) continue;
    const due = parseDueCell(dueText, ctx.termYear);
    if (!due) continue;

    const n = name[1];
    events.push({
      sourceRef: `cs251:A${n}`,
      kind: 'assignment',
      title: `A${n}`,
      date: due.date,
      endDate: null,
      time: due.time,
      timeKnown: due.time !== null,
      sourceUrl: absoluteUrl(cells.eq(0).find('a').first().attr('href'), ctx.pageUrl),
      flags: changed ? ['date_changed'] : [],
    });
  }
  return events;
}
