import type { ItemKind } from '@/config/term-f26';

export const ITEM_KINDS: ItemKind[] = [
  'assignment', 'quiz', 'midterm', 'final', 'project', 'tutorial', 'lab', 'reading', 'admin', 'break', 'other',
];

export const KIND_LABEL: Record<ItemKind, string> = {
  assignment: 'assignment',
  quiz: 'quiz',
  midterm: 'midterm',
  final: 'final exam',
  project: 'project',
  tutorial: 'tutorial',
  lab: 'lab',
  reading: 'reading',
  admin: 'admin date',
  break: 'break',
  other: 'other',
};

/** Kinds the coverage meter counts as assessments. */
export const ASSESSMENT_KINDS: ItemKind[] = ['assignment', 'quiz', 'midterm', 'final', 'project'];

export const EXAM_KINDS: ItemKind[] = ['midterm', 'final'];

export type Progress = 'todo' | 'started' | 'submitted' | 'graded';

export const PROGRESS_LABEL: Record<Progress, string> = {
  todo: 'Todo',
  started: 'Started',
  submitted: 'Submitted',
  graded: 'Graded',
};

export const SOURCE_LABEL: Record<string, string> = {
  manual: 'Added by hand',
  seed: 'Course outline (Fall 2026 setup)',
  learn_ics: 'LEARN',
  cs251_schedule: 'CS 251 schedule page',
  cs251_examinfo: 'CS 251 exam info page',
  cs251_assignments: 'CS 251 assignments page',
  open_data: 'UW Open Data',
  paste: 'Inbox paste',
  piazza_email: 'Piazza email',
  crowdmark_email: 'Crowdmark email',
  note: 'Lecture notes',
  page_diff: 'Page change',
};

/** Flags that mean the date still needs a human check. */
export const FLAG_LABEL: Record<string, string> = {
  date_tba: 'Date TBA',
  time_depends_on_section: 'Time depends on section',
  outline_date_conflict: 'Confirm date',
  no_extensions: 'No extensions',
};

export function sourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? source;
}
