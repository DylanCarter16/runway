import { addDays, differenceInCalendarDays, parseISO } from 'date-fns';
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';

export const TIME_ZONE = 'America/Toronto';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Local calendar date (`YYYY-MM-DD`) for a UTC instant, in America/Toronto. */
export function toTorontoDate(date: Date): string {
  return formatInTimeZone(date, TIME_ZONE, 'yyyy-MM-dd');
}

/** Local clock time (`HH:mm`) for a UTC instant, in America/Toronto. */
export function toTorontoTime(date: Date): string {
  return formatInTimeZone(date, TIME_ZONE, 'HH:mm');
}

/**
 * Converts a local America/Toronto date (and optional `HH:mm` time) to the
 * UTC instant it represents. `time = null` means local midnight — the
 * convention for date-only items (`all_day = true`, `time_known = false`).
 */
export function fromTorontoLocal(date: string, time: string | null): Date {
  const clock = time ?? '00:00';
  return fromZonedTime(`${date}T${clock}:00`, TIME_ZONE);
}

/** Start of the America/Toronto calendar day containing this instant, as a UTC instant. */
export function startOfTorontoDay(date: Date): Date {
  return fromTorontoLocal(toTorontoDate(date), null);
}

/** Adds whole calendar days to a `YYYY-MM-DD` date. */
export function addDaysToDate(date: string, days: number): string {
  return formatInTimeZone(addDays(parseISO(`${date}T12:00:00Z`), days), 'UTC', 'yyyy-MM-dd');
}

/** Calendar days from `a` to `b`, both `YYYY-MM-DD`. */
export function daysBetweenDates(a: string, b: string): number {
  return differenceInCalendarDays(parseISO(b), parseISO(a));
}

/** Short display string for a due date, in America/Toronto. */
export function formatDue(date: Date, timeKnown = true): string {
  return timeKnown
    ? formatInTimeZone(date, TIME_ZONE, 'MMM d, h:mm a')
    : formatInTimeZone(date, TIME_ZONE, 'MMM d');
}

/** "Wed, Sep 30" for lists. */
export function formatListDate(date: Date): string {
  return formatInTimeZone(date, TIME_ZONE, 'EEE, MMM d');
}

/** "Wednesday, September 30" for headings. */
export function formatHeadingDate(date: Date): string {
  return formatInTimeZone(date, TIME_ZONE, 'EEEE, MMMM d');
}

/** "5:00 pm". */
export function formatTime(date: Date): string {
  return formatInTimeZone(date, TIME_ZONE, 'h:mm aaa');
}

/** "Wed, Sep 30, 5:00 pm", or "Wed, Sep 30, time not set". */
export function formatWhen(date: Date, timeKnown: boolean): string {
  return `${formatListDate(date)}, ${timeKnown ? formatTime(date) : 'time not set'}`;
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/**
 * "in 3 days", "in 5 hours", "overdue by 2 hours", "today", "tomorrow".
 * Date-only items count calendar days and are due at the end of their day.
 */
export function formatCountdown(due: Date, timeKnown: boolean, now: Date): string {
  if (!timeKnown) {
    const days = daysBetweenDates(toTorontoDate(now), toTorontoDate(due));
    if (days === 0) return 'today';
    if (days === 1) return 'tomorrow';
    if (days > 1) return `in ${plural(days, 'day')}`;
    return `overdue by ${plural(-days, 'day')}`;
  }
  const diff = due.getTime() - now.getTime();
  const abs = Math.abs(diff);
  let span: string;
  if (abs < HOUR) span = plural(Math.max(1, Math.round(abs / MINUTE)), 'minute');
  else if (abs < 48 * HOUR) span = plural(Math.round(abs / HOUR), 'hour');
  else span = plural(Math.abs(daysBetweenDates(toTorontoDate(now), toTorontoDate(due))), 'day');
  return diff >= 0 ? `in ${span}` : `overdue by ${span}`;
}

/**
 * Term week number: week 1 is the Monday-to-Sunday week holding the first day of classes.
 * null before the term starts or after it ends.
 */
export function termWeek(startsOn: string, endsOn: string, now: Date): number | null {
  const today = toTorontoDate(now);
  if (today < startsOn || today > endsOn) return null;
  const mondayOffset = (d: string) => (parseISO(`${d}T12:00:00Z`).getUTCDay() + 6) % 7;
  const startMonday = addDaysToDate(startsOn, -mondayOffset(startsOn));
  return Math.floor(daysBetweenDates(startMonday, today) / 7) + 1;
}

/** "just now", "12 min ago", "3 hours ago", "Sep 20". */
export function formatAgo(date: Date, now: Date): string {
  const diff = now.getTime() - date.getTime();
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
  if (diff < 24 * HOUR) return `${plural(Math.floor(diff / HOUR), 'hour')} ago`;
  if (diff < 7 * 24 * HOUR) return `${plural(Math.floor(diff / (24 * HOUR)), 'day')} ago`;
  return formatListDate(date);
}

/** ISO 8601 with the Toronto offset for that date: "2026-11-12T16:30:00-05:00". */
export function torontoIso(date: string, time: string): string {
  return formatInTimeZone(fromTorontoLocal(date, time), TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}
