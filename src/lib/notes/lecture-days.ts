import { addDaysToDate, toTorontoDate } from '@/lib/time';

// Lecture days from Quest meetings (courses.meetings). Used for the default
// lecture date on a new note and for the 21:00 lecture-note paste reminders.

const DAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** courses.meetings rows: Quest pastes and the seed use the same snake_case shape. */
export interface MeetingRow {
  component?: string | null;
  days?: string[] | null;
  starts_on?: string | null;
  ends_on?: string | null;
}

/** A break (reading week), inclusive YYYY-MM-DD dates. */
export interface DateRange {
  from: string;
  to: string;
}

function weekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** True when a LEC meeting falls on this date and no break covers it. */
export function isLectureDay(meetings: MeetingRow[], date: string, breaks: DateRange[] = []): boolean {
  if (breaks.some((b) => date >= b.from && date <= b.to)) return false;
  const day = weekday(date);
  return meetings.some(
    (m) =>
      m.component === 'LEC' &&
      (m.days ?? []).some((d) => DAY_INDEX[d] === day) &&
      (!m.starts_on || date >= m.starts_on) &&
      (!m.ends_on || date <= m.ends_on),
  );
}

/** Today when it is a lecture day, else the most recent one in the past two weeks, else today. */
export function defaultLectureDate(meetings: MeetingRow[], today: string, breaks: DateRange[] = []): string {
  for (let i = 0; i <= 14; i++) {
    const d = addDaysToDate(today, -i);
    if (isLectureDay(meetings, d, breaks)) return d;
  }
  return today;
}

/** Break items (reading week) as date ranges. Multi-day items end at local midnight after their last day. */
export function breakRanges(items: { due_at: string | null; starts_at: string | null; ends_at: string | null }[]): DateRange[] {
  const out: DateRange[] = [];
  for (const i of items) {
    const start = i.starts_at ?? i.due_at;
    if (!start) continue;
    const from = toTorontoDate(new Date(start));
    const to = i.ends_at ? addDaysToDate(toTorontoDate(new Date(i.ends_at)), -1) : from;
    out.push({ from, to: to < from ? from : to });
  }
  return out;
}
