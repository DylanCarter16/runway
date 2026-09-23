import type { AnyNode } from 'domhandler';
import type { CheerioAPI, Cheerio } from 'cheerio';
import { absoluteUrl, isoDate, loadPage, monthNumber, pointsToOtherTerm, squish } from './html';
import type { ParsedEvent } from './types';

// CS 251 schedule page (docs/SOURCES.md section 2). Event rows hold a <span> colored
// #a00 (deadline or exam) or #060 (break); every other row is a lecture, even when its
// text mentions an exam.

export interface PageContext {
  pageUrl: string;
  termYear: number;
}

/** "F26" from ".../~cs251/F26/schedule.shtml". */
export function termFolder(pageUrl: string): string {
  return /\/~[a-z0-9]+\/([FWS]\d{2})\//i.exec(new URL(pageUrl).pathname)?.[1] ?? '';
}

/** "Sep 10", "Sept 30", "Oct 13-15", "Nov 30 - Dec 2", "TBA". */
export function parseDateCell(text: string, year: number): { date: string | null; endDate: string | null } | null {
  const t = squish(text);
  if (/^tba$/i.test(t)) return { date: null, endDate: null };
  const m = /^([A-Za-z]+)\.?\s+(\d{1,2})(?:\s*[-–]\s*(?:([A-Za-z]+)\.?\s+)?(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const month = monthNumber(m[1]);
  if (!month) return null;
  const date = isoDate(year, month, Number(m[2]));
  if (!m[4]) return { date, endDate: null };
  const endMonth = m[3] ? monthNumber(m[3]) : month;
  if (!endMonth) return null;
  return { date, endDate: isoDate(year, endMonth, Number(m[4])) };
}

function spanColor($: CheerioAPI, cell: Cheerio<AnyNode>): { color: 'a00' | '060'; span: Cheerio<AnyNode> } | null {
  for (const el of cell.find('span').toArray()) {
    const style = ($(el).attr('style') ?? '').toLowerCase().replace(/\s+/g, '');
    if (style.includes('color:#a00')) return { color: 'a00', span: $(el) };
    if (style.includes('color:#060')) return { color: '060', span: $(el) };
  }
  return null;
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function parseCs251Schedule(html: string, ctx: PageContext): ParsedEvent[] {
  const $ = loadPage(html);
  const folder = termFolder(ctx.pageUrl);
  const events: ParsedEvent[] = [];

  for (const row of $('table.schedule tr').toArray()) {
    const cells = $(row).children('td');
    if (cells.length < 2) continue;
    const hit = spanColor($, cells.eq(1));
    if (!hit) continue;
    const when = parseDateCell(cells.eq(0).text(), ctx.termYear);
    if (!when) continue;

    const text = squish(hit.span.text());
    const flags: string[] = [];
    if (!when.date) flags.push('date_tba');
    const sourceUrl = absoluteUrl(hit.span.find('a').first().attr('href'), ctx.pageUrl);
    if (sourceUrl && folder && pointsToOtherTerm(sourceUrl, folder)) flags.push('link_points_to_other_term');
    const base = { date: when.date, endDate: when.endDate, time: null, timeKnown: false, flags };

    if (hit.color === '060') {
      const start = when.date ?? 'tba';
      events.push({ ...base, sourceRef: `cs251:break:${start}`, kind: 'break', title: text, sourceUrl });
      continue;
    }

    const assignment = /^A(\d+)\s+due\b/i.exec(text);
    if (assignment) {
      events.push({ ...base, sourceRef: `cs251:A${assignment[1]}`, kind: 'assignment', title: `A${assignment[1]}`, sourceUrl });
    } else if (/midterm/i.test(text)) {
      events.push({ ...base, sourceRef: 'cs251:midterm', kind: 'midterm', title: 'Midterm', sourceUrl });
    } else if (/final exam/i.test(text)) {
      events.push({ ...base, sourceRef: 'cs251:final', kind: 'final', title: 'Final exam', sourceUrl });
    } else {
      events.push({ ...base, sourceRef: `cs251:other:${when.date ?? 'tba'}:${slug(text)}`, kind: 'other', title: text, sourceUrl });
    }
  }
  return events;
}
