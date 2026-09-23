import { addDaysToDate, fromTorontoLocal } from '@/lib/time';

// Items with no course (reading week, exam period, UW important dates) belong to a
// term by date. Deleting a term takes the ones that start or are due inside it.

/** The term as UTC instants: its first day's Toronto midnight up to the day after it ends. */
export function termRange(term: { starts_on: string; ends_on: string }): { from: string; to: string } {
  return {
    from: fromTorontoLocal(term.starts_on, null).toISOString(),
    to: fromTorontoLocal(addDaysToDate(term.ends_on, 1), null).toISOString(),
  };
}

/** PostgREST `or` filter for items that start or are due inside the term. */
export function termDatedFilter(term: { starts_on: string; ends_on: string }): string {
  const { from, to } = termRange(term);
  return `and(due_at.gte.${from},due_at.lt.${to}),and(starts_at.gte.${from},starts_at.lt.${to})`;
}
