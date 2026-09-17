import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';

export const TIME_ZONE = 'America/Toronto';

/** Local calendar date (`YYYY-MM-DD`) for a UTC instant, in America/Toronto. */
export function toTorontoDate(date: Date): string {
  return formatInTimeZone(date, TIME_ZONE, 'yyyy-MM-dd');
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

/** Short display string for a due date, in America/Toronto. */
export function formatDue(date: Date, timeKnown = true): string {
  return timeKnown
    ? formatInTimeZone(date, TIME_ZONE, 'MMM d, h:mm a')
    : formatInTimeZone(date, TIME_ZONE, 'MMM d');
}
