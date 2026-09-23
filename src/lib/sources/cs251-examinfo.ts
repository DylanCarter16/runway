import { torontoIso } from '@/lib/time';
import { clock, isoDate, loadPage, monthNumber, squish } from './html';
import type { PageContext } from './cs251-schedule';
import type { ParsedExam } from './types';

// CS 251 exam info page (docs/SOURCES.md section 3). Reads the "Midterm" and
// "Final Exam" h2 sections. A section whose only text is "TBA" has no date yet.

const WHEN =
  /(?:[A-Za-z]+day,?\s+)?([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(?:(\d{4}),?\s*)?(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?\s*(?:-|–|to)\s*(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)/i;

function minutesOf(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

/** "Thursday, November 12, 4:30-6:20pm" → local date, start, and end. */
export function parseExamWhen(text: string, termYear: number): { date: string; start: string; end: string } | null {
  const m = WHEN.exec(text);
  if (!m) return null;
  const month = monthNumber(m[1]);
  if (!month) return null;
  const date = isoDate(m[3] ? Number(m[3]) : termYear, month, Number(m[2]));
  const end = clock(m[7], m[8], m[9]);
  let start = clock(m[4], m[5], m[6] ?? m[9]);
  if (!end || !start) return null;
  // "11:30-1:00pm": the start inherits pm and lands after the end, so it was am.
  if (!m[6] && minutesOf(start) > minutesOf(end)) start = clock(m[4], m[5], 'am');
  if (!start) return null;
  return { date, start, end };
}

export function parseCs251ExamInfo(html: string, ctx: PageContext): ParsedExam[] {
  const $ = loadPage(html);
  $('br').replaceWith('\n');
  const exams: ParsedExam[] = [];

  for (const heading of $('h2').toArray()) {
    const name = squish($(heading).text());
    const kind = /midterm/i.test(name) ? 'midterm' : /final/i.test(name) ? 'final' : null;
    if (!kind) continue;

    const body = $(heading).nextUntil('h1, h2').toArray().map((el) => $(el).text()).join('\n');
    const lines = body.split('\n').map(squish).filter(Boolean);
    const text = lines.join(' ');

    const flags: string[] = [];
    const when = /^tba$/i.test(text) ? null : parseExamWhen(text, ctx.termYear);
    if (!when) flags.push('date_tba');

    const locLine = lines.find((l) => /^location\s*:/i.test(l));
    let location = locLine ? squish(locLine.replace(/^location\s*:/i, '')) : null;
    if (!location || /^tba\b/i.test(location)) {
      location = null;
      flags.push('location_tba');
    }

    exams.push({
      sourceRef: `cs251:${kind}`,
      kind,
      title: kind === 'midterm' ? 'Midterm' : 'Final exam',
      startsAt: when ? torontoIso(when.date, when.start) : null,
      endsAt: when ? torontoIso(when.date, when.end) : null,
      durationMinutes: when ? minutesOf(when.end) - minutesOf(when.start) : null,
      location,
      flags,
    });
  }
  return exams;
}
