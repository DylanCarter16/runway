import type { ItemKind } from '@/config/term-f26';
import { prepDaysFor } from '@/lib/reminders/rules';
import { addDaysToDate, fromTorontoLocal, toTorontoDate } from '@/lib/time';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface RunwayInput {
  kind: ItemKind;
  due_at: string | null;
  starts_at: string | null;
  time_known: boolean;
  progress: string;
  prep_days: number | null;
  courseSlug: string | null;
}

export type RunwayStatus = 'none' | 'upcoming' | 'active' | 'soon' | 'overdue' | 'submitted';

export interface RunwayState {
  status: RunwayStatus;
  /** 0 to 1: how much of the prep window has passed. */
  fraction: number;
  prepDays: number;
  start: Date | null;
  due: Date | null;
  /** Screen reader text, e.g. "Prep window, day 4 of 7". */
  label: string;
}

/** The instant an item is due or starts. Date-only items are due at the end of their day. */
export function effectiveDue(item: Pick<RunwayInput, 'due_at' | 'starts_at' | 'time_known'>): Date | null {
  const at = item.due_at ?? item.starts_at;
  if (!at) return null;
  const date = new Date(at);
  if (item.time_known) return date;
  return fromTorontoLocal(addDaysToDate(toTorontoDate(date), 1), null);
}

export function isDone(progress: string): boolean {
  return progress === 'submitted' || progress === 'graded';
}

export function runwayState(item: RunwayInput, now: Date): RunwayState {
  const due = effectiveDue(item);
  const prepDays = prepDaysFor(item.kind, item.courseSlug, item.prep_days);
  if (!due) return { status: 'none', fraction: 0, prepDays, start: null, due: null, label: 'No date yet' };

  const start = new Date(due.getTime() - prepDays * DAY);
  const span = Math.max(due.getTime() - start.getTime(), 1);
  const fraction = Math.min(1, Math.max(0, (now.getTime() - start.getTime()) / span));
  const base = { fraction, prepDays, start, due };

  if (isDone(item.progress)) return { ...base, status: 'submitted', label: 'Submitted' };
  if (now >= due) return { ...base, fraction: 1, status: 'overdue', label: 'Past due, not submitted' };
  if (due.getTime() - now.getTime() <= 48 * HOUR) {
    return { ...base, status: 'soon', label: 'Due within 48 hours' };
  }
  if (prepDays === 0) return { ...base, status: 'none', label: 'No prep window' };
  if (now < start) return { ...base, status: 'upcoming', label: `Prep window opens in ${Math.ceil((start.getTime() - now.getTime()) / DAY)} days` };
  const day = Math.min(prepDays, Math.floor((now.getTime() - start.getTime()) / DAY) + 1);
  return { ...base, status: 'active', label: `Prep window, day ${day} of ${prepDays}` };
}
