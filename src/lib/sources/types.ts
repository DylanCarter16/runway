// Output shapes shared by the page parsers (docs/SOURCES.md, "Parser output shape").
// Parsers are pure functions; the sync steps in src/lib/sync write their results.

export type ParsedKind = 'assignment' | 'quiz' | 'midterm' | 'final' | 'project' | 'break' | 'admin' | 'other';

export interface ParsedEvent {
  /** Stable id, e.g. "cs251:A1". */
  sourceRef: string;
  kind: ParsedKind;
  title: string;
  /** YYYY-MM-DD in America/Toronto; null when TBA. */
  date: string | null;
  /** Last day of a range such as reading week. */
  endDate: string | null;
  /** HH:MM local; null when the page gives no time. */
  time: string | null;
  timeKnown: boolean;
  /** Absolute URL. */
  sourceUrl: string | null;
  flags: string[];
}

export interface ParsedExam {
  /** "cs251:midterm", "cs251:final". */
  sourceRef: string;
  kind: 'midterm' | 'final';
  title: string;
  /** ISO 8601 with the Toronto offset for that date. */
  startsAt: string | null;
  endsAt: string | null;
  durationMinutes: number | null;
  location: string | null;
  flags: string[];
}
