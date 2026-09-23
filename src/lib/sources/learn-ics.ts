import ical, { type VEvent } from 'node-ical';
import type { IncomingItem } from '@/lib/sync/merge';
import { addDaysToDate, toTorontoDate } from '@/lib/time';

// LEARN calendar feed (docs/SOURCES.md section 1). Pure: text in, items out.
// The feed URL holds a private token, so nothing here ever sees or logs it.

export interface LearnCourse {
  id: string;
  learnNames: string[];
}

export interface LearnWindow {
  /** Term start and end, YYYY-MM-DD. Events count from 7 days before to 7 days after. */
  startsOn: string;
  endsOn: string;
}

export interface LearnParseResult {
  matched: IncomingItem[];
  /** Events that name no course; they go to the review queue with course unset. */
  unmatched: IncomingItem[];
  skipped: number;
}

type Param = string | { val: string } | undefined;

function value(p: unknown): string {
  const v = p as Param;
  if (!v) return '';
  return typeof v === 'string' ? v : (v.val ?? '');
}

/** Keyword match on the title; LEARN deadlines default to assignment. */
export function learnKind(title: string): string {
  const t = title.toLowerCase();
  if (/\bquiz/.test(t)) return 'quiz';
  if (/\bmidterm|\bterm test/.test(t)) return 'midterm';
  if (/\bfinal\b|\bexam\b/.test(t)) return 'final';
  return 'assignment';
}

/** "Assignment 1 - Due" → "Assignment 1". */
export function learnTitle(summary: string): string {
  const t = summary.replace(/\s+/g, ' ').trim();
  return t.replace(/\s*[-–:]\s*(due|availability ends|ends|end date)$/i, '').trim() || t;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ');
}

function matchCourse(text: string, courses: LearnCourse[]): string | null {
  const hay = normalize(text);
  const hits = courses.filter((c) => c.learnNames.some((n) => n && hay.includes(normalize(n))));
  return hits.length === 1 ? hits[0].id : null;
}

type DateLike = Date & { dateOnly?: boolean };

/** YYYY-MM-DD for a date-only value; node-ical builds those at local midnight of the machine. */
function localDate(d: DateLike): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toItem(ev: Omit<VEvent, 'recurrences'>, ref: string, courses: LearnCourse[]): IncomingItem | null {
  const start = ev.start as DateLike | undefined;
  if (!start) return null;
  const summary = value(ev.summary);
  const location = value(ev.location);
  const description = value(ev.description);
  const dateOnly = ev.datetype === 'date' || start.dateOnly === true;
  const title = learnTitle(summary);

  // Date-only DTEND is exclusive (the next day), so date-only events use DTSTART.
  const at = dateOnly ? null : ((ev.end as DateLike | undefined) ?? start);
  return {
    sourceRef: ref,
    kind: learnKind(title),
    title,
    when: at
      ? { type: 'timed', dueAt: at.toISOString(), startsAt: null, endsAt: null }
      : { type: 'date', date: localDate(start), endDate: null },
    location: null,
    sourceUrl: typeof ev.url === 'string' && /^https?:\/\//.test(ev.url) ? ev.url : null,
    flags: [],
    courseId: matchCourse(`${summary}\n${location}\n${description}`, courses),
    description: description ? description.slice(0, 2000) : null,
  };
}

function itemDate(item: IncomingItem): string | null {
  if (!item.when) return null;
  return item.when.type === 'date' ? item.when.date : toTorontoDate(new Date(item.when.dueAt));
}

export function parseLearnIcs(text: string, courses: LearnCourse[], window: LearnWindow): LearnParseResult {
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    throw new Error('The LEARN feed did not return a calendar. Check that the feed URL is the one from LEARN, Calendar, Subscribe.');
  }
  const data = ical.sync.parseICS(text);
  const from = addDaysToDate(window.startsOn, -7);
  const to = addDaysToDate(window.endsOn, 7);
  const out: LearnParseResult = { matched: [], unmatched: [], skipped: 0 };

  const push = (item: IncomingItem | null) => {
    const date = item ? itemDate(item) : null;
    if (!item || !date || date < from || date > to) {
      out.skipped++;
      return;
    }
    (item.courseId ? out.matched : out.unmatched).push(item);
  };

  for (const component of Object.values(data)) {
    if (!component || component.type !== 'VEVENT') continue;
    const ev = component as VEvent;
    push(toItem(ev, ev.uid, courses));
    for (const [key, override] of Object.entries(ev.recurrences ?? {})) {
      const rid = override.recurrenceid ? new Date(override.recurrenceid as unknown as string).toISOString() : key;
      push(toItem(override, `${ev.uid}:${rid}`, courses));
    }
  }
  return out;
}
