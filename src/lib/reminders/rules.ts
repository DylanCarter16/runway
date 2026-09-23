import type { ItemKind } from '@/config/term-f26';

const MIN = 1;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export interface ReminderRule {
  /** Days of runway (prep window) before the due date. 0 means no prep window. */
  prepDays: number;
  /** Minutes before the due or start time. At most 5, at most 40320 (Google Calendar limits). */
  reminders: number[];
  /** Exams get study blocks instead of one prep block. */
  studyBlocks?: 'three_in_week' | 'every_other_day';
}

/** Defaults from docs/SPEC.md section 5. Settings and per-item fields override them. */
export const DEFAULT_RULES: Record<ItemKind, ReminderRule> = {
  assignment: { prepDays: 7, reminders: [7 * DAY, 3 * DAY, 1 * DAY, 3 * HOUR] },
  project: { prepDays: 21, reminders: [14 * DAY, 7 * DAY, 3 * DAY, 1 * DAY] },
  quiz: { prepDays: 2, reminders: [2 * DAY, 2 * HOUR] },
  midterm: { prepDays: 7, reminders: [10 * DAY, 3 * DAY, 1 * DAY, 2 * HOUR], studyBlocks: 'three_in_week' },
  final: {
    prepDays: 14,
    reminders: [14 * DAY, 7 * DAY, 3 * DAY, 1 * DAY, 2 * HOUR],
    studyBlocks: 'every_other_day',
  },
  tutorial: { prepDays: 0, reminders: [1 * DAY, 1 * HOUR] },
  lab: { prepDays: 0, reminders: [1 * DAY, 1 * HOUR] },
  admin: { prepDays: 0, reminders: [7 * DAY, 1 * DAY] },
  break: { prepDays: 0, reminders: [] },
  reading: { prepDays: 0, reminders: [1 * DAY] },
  other: { prepDays: 0, reminders: [1 * DAY] },
};

/** Course-specific overrides: CS 246 assignments get 10 days of runway. */
const COURSE_PREP_DAYS: Record<string, Partial<Record<ItemKind, number>>> = {
  cs246: { assignment: 10 },
};

export function prepDaysFor(kind: ItemKind, courseSlug: string | null, override?: number | null): number {
  if (override !== null && override !== undefined) return override;
  const courseValue = courseSlug ? COURSE_PREP_DAYS[courseSlug]?.[kind] : undefined;
  return courseValue ?? DEFAULT_RULES[kind].prepDays;
}
