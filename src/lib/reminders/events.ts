import type { ItemKind } from '@/config/term-f26';
import { addDaysToDate, fromTorontoLocal, toTorontoDate } from '@/lib/time';
import { MAX_REMINDER_MINUTES, resolveRule, type RuleOverrides } from './rules';

// What each item and reminder looks like on the Runway Google calendar (docs/SPEC.md
// section 5). Pure: the calendar sync turns these into Google event bodies and diffs
// them against what the calendar already holds.

const MINUTE = 60_000;
const BLOCK_MINUTES = 90;
const DEADLINE_MINUTES = 15;
const EXAM_DEFAULT_MINUTES = 60;
/** Date-only items count their reminders back from 9:00 on the due date. */
const ALL_DAY_ANCHOR_MINUTES = 9 * 60;

/** Kinds that happen at their time (the event starts then), rather than being due then. */
const HAPPENS_AT = new Set<ItemKind>(['midterm', 'final', 'quiz', 'tutorial', 'lab']);

export type EventTime = { date: string } | { dateTime: string };

export interface PlannedEvent {
  /** Stable key: item:<id>, item:<id>:prep, item:<id>:start, item:<id>:study:<date>, reminder:<id>. */
  runwayId: string;
  /** The item or reminder row this event belongs to. */
  owner: { table: 'items' | 'reminders'; id: string; main: boolean };
  summary: string;
  description: string;
  location: string | null;
  start: EventTime;
  end: EventTime;
  /** Popup reminder offsets in minutes before the start. Empty means no notification. */
  reminders: number[];
  /** Background events (breaks, prep days) don't block time. */
  transparent: boolean;
}

export interface PlanItem {
  id: string;
  kind: ItemKind;
  title: string;
  courseCode: string | null;
  courseSlug: string | null;
  due_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  all_day: boolean;
  time_known: boolean;
  location: string | null;
  seat: string | null;
  state: string;
  progress: string;
  created_at: string;
  source_url: string | null;
  prep_days: number | null;
  reminder_minutes: number[] | null;
}

export interface PlanContext {
  appUrl: string;
  /** Local hour (0 to 23) for prep and study blocks. */
  studyBlockHour: number;
  overrides?: RuleOverrides;
}

/** "CS 251 A3", without doubling a code the title already starts with. */
export function eventLabel(courseCode: string | null, title: string): string {
  if (!courseCode) return title;
  const squash = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  return squash(title).startsWith(squash(courseCode)) ? title : `${courseCode} ${title}`;
}

function timed(at: Date): EventTime {
  return { dateTime: at.toISOString() };
}

function shift(minutes: number[], by: number): number[] {
  return minutes.map((m) => m - by).filter((m) => m >= 0 && m <= MAX_REMINDER_MINUTES);
}

function block(date: string, hour: number): { start: EventTime; end: EventTime } {
  const start = fromTorontoLocal(date, `${String(hour).padStart(2, '0')}:00`);
  return {
    start: timed(start),
    end: timed(new Date(start.getTime() + BLOCK_MINUTES * MINUTE)),
  };
}

function describe(item: PlanItem, appUrl: string): string {
  const lines = [`Open in Runway: ${appUrl.replace(/\/$/, '')}/items/${item.id}`];
  if (item.source_url) lines.push(`Source: ${item.source_url}`);
  if (!item.time_known) lines.push('Time not set yet.');
  return lines.join('\n');
}

function where(item: PlanItem): string | null {
  const parts = [item.location, item.seat ? `seat ${item.seat}` : null].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/** Days (relative to the exam date, negative) that get a study block. */
export function studyDays(kind: 'three_in_week' | 'every_other_day', prepDays: number): number[] {
  if (kind === 'three_in_week') return [-6, -4, -2].filter((d) => -d <= prepDays);
  const days: number[] = [];
  for (let d = prepDays; d >= 2; d -= 2) days.push(-d);
  return days;
}

/**
 * Every calendar event one item needs: the item itself plus its prep or study blocks.
 * Dismissed and undated items need none. Submitted items keep the main event with a
 * check mark and no reminders, and lose their blocks.
 */
export function planItemEvents(item: PlanItem, ctx: PlanContext): PlannedEvent[] {
  const anchorIso = item.due_at ?? item.starts_at;
  if (item.state !== 'active' || !anchorIso) return [];

  const done = item.progress === 'submitted' || item.progress === 'graded';
  const rule = resolveRule(item.kind, item.courseSlug, ctx.overrides, item);
  const label = eventLabel(item.courseCode, item.title);
  const owner = { table: 'items' as const, id: item.id };
  const description = describe(item, ctx.appUrl);
  const location = where(item);
  const background = item.kind === 'break';

  const anchor = new Date(anchorIso);
  const anchorDate = toTorontoDate(anchor);
  let start: EventTime;
  let end: EventTime;
  let reminders: number[];

  if (item.all_day || !item.time_known) {
    const first = toTorontoDate(new Date(item.starts_at ?? anchorIso));
    // ends_at of a multi-day item is local midnight after its last day, which is
    // exactly Google's exclusive end date.
    const endDate = item.ends_at ? toTorontoDate(new Date(item.ends_at)) : addDaysToDate(first, 1);
    start = { date: first };
    end = { date: endDate > first ? endDate : addDaysToDate(first, 1) };
    // All-day reminders count from local midnight; the rule counts back from 9:00.
    // Offsets that would land after midnight on the day itself are dropped.
    reminders = shift(rule.reminders, ALL_DAY_ANCHOR_MINUTES);
  } else if (item.starts_at && item.ends_at) {
    start = timed(new Date(item.starts_at));
    end = timed(new Date(item.ends_at));
    reminders = rule.reminders;
  } else if (HAPPENS_AT.has(item.kind)) {
    start = timed(anchor);
    end = timed(new Date(anchor.getTime() + EXAM_DEFAULT_MINUTES * MINUTE));
    reminders = rule.reminders;
  } else {
    // A deadline: a short block that ends at the due time. Reminders still count
    // back from the due time, so they shift by the block's length.
    start = timed(new Date(anchor.getTime() - DEADLINE_MINUTES * MINUTE));
    end = timed(anchor);
    reminders = shift(rule.reminders, DEADLINE_MINUTES);
  }

  const summary = `${done ? '✓ ' : ''}${label}${item.time_known ? '' : ' (time TBD)'}`;
  const events: PlannedEvent[] = [
    {
      runwayId: `item:${item.id}`,
      owner: { ...owner, main: true },
      summary,
      description,
      location,
      start,
      end,
      reminders: done || background ? [] : reminders,
      transparent: background,
    },
  ];
  if (done || background || rule.prepDays <= 0) return events;

  // Blocks dated before the item existed would only fill past days of the calendar.
  const createdDate = toTorontoDate(new Date(item.created_at));
  const blockEvent = (runwayId: string, title: string, date: string): PlannedEvent => ({
    runwayId,
    owner: { ...owner, main: false },
    summary: title,
    description,
    location: null,
    ...block(date, ctx.studyBlockHour),
    reminders: [10],
    transparent: false,
  });

  if (rule.studyBlocks) {
    for (const offset of studyDays(rule.studyBlocks, rule.prepDays)) {
      const date = addDaysToDate(anchorDate, offset);
      if (date < createdDate) continue;
      events.push(blockEvent(`item:${item.id}:study:${date}`, `Study: ${label}`, date));
    }
    return events;
  }

  const prepDate = addDaysToDate(anchorDate, -rule.prepDays);
  if (prepDate < createdDate) return events;
  events.push({
    runwayId: `item:${item.id}:prep`,
    owner: { ...owner, main: false },
    summary: `Prep: ${label}`,
    description,
    location: null,
    start: { date: prepDate },
    end: { date: addDaysToDate(prepDate, 1) },
    reminders: [],
    transparent: true,
  });
  events.push(blockEvent(`item:${item.id}:start`, `Start ${label}`, prepDate));
  return events;
}

export interface PlanReminder {
  id: string;
  title: string;
  where_to_find: string | null;
  url: string | null;
  remind_at: string;
  snoozed_until: string | null;
  done_at: string | null;
}

/** Paste and check reminders: a short timed event that notifies when it starts. */
export function planReminderEvent(r: PlanReminder, appUrl: string): PlannedEvent | null {
  if (r.done_at) return null;
  const at = new Date(r.snoozed_until && r.snoozed_until > r.remind_at ? r.snoozed_until : r.remind_at);
  const base = appUrl.replace(/\/$/, '');
  const url = r.url?.startsWith('/') ? `${base}${r.url}` : r.url;
  const lines = [r.where_to_find, url, `Mark it done in Runway: ${base}/inbox#paste-reminders`].filter((l): l is string => Boolean(l));
  return {
    runwayId: `reminder:${r.id}`,
    owner: { table: 'reminders', id: r.id, main: true },
    summary: r.title,
    description: lines.join('\n'),
    location: null,
    start: timed(at),
    end: timed(new Date(at.getTime() + DEADLINE_MINUTES * MINUTE)),
    reminders: [0],
    transparent: true,
  };
}
