// The shape of a term config: what "Load term setup" (Settings, Term) imports with an
// idempotent upsert. Copy src/config/term.example.ts to src/config/term.local.ts (gitignored),
// fill it in from your outlines and Quest schedule, then run `npm run term:upload` to store it
// in your settings row. The app loads the stored config, or the example when there is none.
//
// Dates are YYYY-MM-DD and times HH:MM in the term's time zone (America/Toronto).
// Every seed item needs a stable, unique sourceRef so loading twice changes nothing.

export type LinkCategory =
  | 'course_site'
  | 'discussion'
  | 'lms'
  | 'submission'
  | 'grades'
  | 'notes'
  | 'exam'
  | 'outline'
  | 'office_hours'
  | 'contact'
  | 'policy'
  | 'other';

export type PageParser = 'diff' | 'cs251_schedule' | 'cs251_examinfo' | 'cs251_assignments';
export type PageCadence = 'hourly' | 'every_3h' | 'daily';
export type ItemKind =
  | 'assignment'
  | 'quiz'
  | 'midterm'
  | 'final'
  | 'project'
  | 'tutorial'
  | 'lab'
  | 'reading'
  | 'admin'
  | 'break'
  | 'other';

export interface SeedLink {
  label: string;
  url: string;
  category: LinkCategory;
  whereToFind?: string;
  pinned?: boolean;
}

export interface SeedPage {
  label: string;
  url: string;
  parser: PageParser;
  cadence: PageCadence;
}

export interface SeedItem {
  /** Stable id. Stored as items.source_ref with source 'seed'. */
  sourceRef: string;
  kind: ItemKind;
  title: string;
  /** YYYY-MM-DD in America/Toronto. null when the outline says TBA. */
  date: string | null;
  /** HH:MM local. null when unknown or when it depends on Dylan's section. */
  time: string | null;
  /** Last day of a multi-day item, YYYY-MM-DD. */
  endDate?: string;
  durationMinutes?: number;
  /** Room, when the outline or Quest names one. */
  location?: string;
  weightPercent?: number;
  description?: string;
  /** Stored in items.flags: date_tba, time_depends_on_section, outline_date_conflict, no_extensions. */
  flags?: string[];
}

export interface SeedMeeting {
  component: 'LEC' | 'TUT' | 'TST';
  section: string;
  classNumber: string;
  days: ('Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri')[];
  /** HH:MM local. */
  startTime: string;
  endTime: string;
  /** null when the room is assigned through Odyssey. */
  location: string | null;
  instructor?: string;
  startsOn: string;
  endsOn: string;
}

export interface SeedGradeComponent {
  component: string;
  weightPercent: number;
  notes?: string;
}

export interface SeedStaff {
  name: string;
  role: string;
  email?: string;
  office?: string;
  notes?: string;
}

export interface SeedOfficeHours {
  who: string;
  when: string;
  where?: string;
}

export interface SeedCourse {
  code: string;
  slug: string;
  title: string;
  /** Light and dark theme marks. Used for chips and left bars, never for text. */
  color: string;
  colorDark: string;
  siteUrl: string | null;
  outlineUrl: string | null;
  submissionPlatforms: string[];
  latePolicy: string | null;
  remarkPolicy: string | null;
  /** Summary of the outline's Generative AI section. */
  aiPolicy: string;
  /** false: Runway never sends this course's notes, pastes, emails, or pages to Claude. */
  aiAllowed: boolean;
  gradingScheme: SeedGradeComponent[];
  staff: SeedStaff[];
  officeHours: SeedOfficeHours[];
  /** Your enrolled sections, from your Quest schedule. */
  meetings: SeedMeeting[];
  checklist: string[];
  infoNotes: string | null;
  /** Strings that identify this course inside LEARN calendar feed events. */
  learnNames: string[];
  links: SeedLink[];
  watchedPages: SeedPage[];
  /** Dated items from the outline. CS 251's assignments and exams come from its page parsers instead. */
  seedItems: SeedItem[];
}

export interface SeedTerm {
  code: string;
  name: string;
  startsOn: string;
  endsOn: string;
  timezone: string;
  courses: SeedCourse[];
  /** Term-wide dates that belong to no course. */
  termItems: SeedItem[];
  globalLinks: SeedLink[];
  piazzaClasses: { nid: string; url: string }[];
}

/**
 * Course mark colours that pass the DESIGN.md checks: 3:1 against paper and sheet in both
 * themes, and well away from UW gold (the accent). tests/lib/design-contrast.test.ts holds them to it.
 */
export const COURSE_PALETTE = {
  teal: { color: '#0F7B83', colorDark: '#5CC4CB' },
  violet: { color: '#5B4FD1', colorDark: '#A59BFF' },
  pink: { color: '#B0266E', colorDark: '#F27AB4' },
  green: { color: '#2F7D3A', colorDark: '#7BC98A' },
} as const;
