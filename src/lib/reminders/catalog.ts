import { addDaysToDate, fromTorontoLocal, toTorontoDate } from '@/lib/time';
import { eventLabel } from './events';

// The paste reminder catalog (docs/SOURCES.md section 11), generated from the term,
// the courses, and the items. Pure: the reminders job writes the drafts, keyed by
// dedupe_key, so running it again changes nothing.
//
// Generated here: quest_schedule, piazza_resources, learn_announcements, seat,
// finals_check, sweep. The ones triggered by an email or an announcement (outline,
// cs246_assignment, crowdmark, grades) arrive with email ingest in Phase 7, and the
// lecture-note reminders with Notes in Phase 5.

export const ODYSSEY_URL = 'https://odyssey.uwaterloo.ca/teaching/schedule';
export const QUEST_URL = 'https://quest.pecs.uwaterloo.ca/';
export const LEARN_URL = 'https://learn.uwaterloo.ca/';
export const FINALS_URL = 'https://uwaterloo.ca/the-centre/academics/final-examination-schedule';
/** The day after the Fall 2026 final exam schedule is published (Oct 2). */
const FINALS_CHECK_ON = '2026-10-03';

/** Weekly reminders are generated this many days ahead, so the next Sunday always exists. */
const HORIZON_DAYS = 8;

export interface ReminderDraft {
  dedupe_key: string;
  kind: 'paste' | 'check' | 'sweep';
  paste_kind: string;
  title: string;
  where_to_find: string;
  url: string | null;
  remind_at: string;
  course_id: string | null;
  item_id: string | null;
  /** The thing it asks for is already in Runway: mark it done. */
  done: boolean;
}

export interface CatalogCourse {
  id: string;
  slug: string;
  code: string;
  hasMeetings: boolean;
  /** Courses that post announcements on LEARN (their learnNames aren't empty). */
  usesLearn: boolean;
  /** The course's Piazza link, if it has one. */
  piazzaUrl: string | null;
}

export interface CatalogExam {
  id: string;
  courseId: string | null;
  courseCode: string | null;
  kind: 'midterm' | 'final';
  title: string;
  /** starts_at, else due_at. */
  at: string;
  seat: string | null;
}

export interface CatalogInput {
  term: { code: string; startsOn: string; endsOn: string };
  /** Last day of classes: weekly LEARN reminders stop after it. */
  classesEndOn: string;
  courses: CatalogCourse[];
  exams: CatalogExam[];
  /** True when the UW Open Data sync has imported at least one final. */
  finalsImported: boolean;
  now: Date;
}

function at(date: string, time: string): string {
  return fromTorontoLocal(date, time).toISOString();
}

/** Sundays (YYYY-MM-DD) from today through the horizon, within [from, to]. */
function sundays(today: string, from: string, to: string): string[] {
  const out: string[] = [];
  for (let i = 0; i <= HORIZON_DAYS; i++) {
    const d = addDaysToDate(today, i);
    if (d < from || d > to) continue;
    if (new Date(`${d}T12:00:00Z`).getUTCDay() === 0) out.push(d);
  }
  return out;
}

function piazzaResources(url: string): string {
  const m = /piazza\.com\/class\/([a-z0-9]+)/i.exec(url);
  return m ? `https://piazza.com/class/${m[1]}/resources` : url;
}

export function reminderCatalog(input: CatalogInput): ReminderDraft[] {
  const { term, courses, now } = input;
  const today = toTorontoDate(now);
  const out: ReminderDraft[] = [];
  const base = { course_id: null, item_id: null, done: false };

  out.push({
    ...base,
    dedupe_key: `quest_schedule:${term.code}`,
    kind: 'paste',
    paste_kind: 'quest_schedule',
    title: 'Paste your Quest class schedule (List View)',
    where_to_find: 'Quest, Class Schedule, List View. Paste it again after any enrolment change.',
    url: QUEST_URL,
    remind_at: at(term.startsOn, '09:00'),
    // The sections are already in Runway (seeded or pasted).
    done: courses.length > 0 && courses.every((c) => c.hasMeetings),
  });

  for (const c of courses) {
    if (c.piazzaUrl) {
      out.push({
        ...base,
        course_id: c.id,
        dedupe_key: `piazza_resources:${c.slug}`,
        kind: 'paste',
        paste_kind: 'piazza_resources',
        title: `Paste the ${c.code} Piazza Resources tab`,
        where_to_find: `Piazza, ${c.code}, Resources: course info, staff, and office hours.`,
        url: piazzaResources(c.piazzaUrl),
        remind_at: at(addDaysToDate(term.startsOn, 2), '09:00'),
      });
    }
    if (c.usesLearn) {
      for (const sunday of sundays(today, term.startsOn, input.classesEndOn)) {
        out.push({
          ...base,
          course_id: c.id,
          dedupe_key: `learn_announcements:${c.slug}:${sunday}`,
          kind: 'paste',
          paste_kind: 'learn_announcements',
          title: `Paste new ${c.code} LEARN announcements`,
          where_to_find: `LEARN, ${c.code} course home, Announcements.`,
          url: LEARN_URL,
          remind_at: at(sunday, '18:00'),
        });
      }
    }
  }

  for (const sunday of sundays(today, term.startsOn, term.endsOn)) {
    out.push({
      ...base,
      dedupe_key: `sweep:${sunday}`,
      kind: 'sweep',
      paste_kind: 'sweep',
      title: 'Weekly sweep: check everything still pending',
      where_to_find: 'Runway Inbox: proposals to review and paste reminders.',
      url: '/inbox',
      remind_at: at(sunday, '18:00'),
    });
  }

  for (const exam of input.exams) {
    const examAt = new Date(exam.at);
    if (examAt <= now) continue;
    // "CS 251 midterm", "STAT 230 midterm 1".
    const name = /^(midterm|final)/i.test(exam.title) ? exam.title.charAt(0).toLowerCase() + exam.title.slice(1) : exam.title;
    const label = eventLabel(exam.courseCode, name);
    out.push({
      ...base,
      course_id: exam.courseId,
      item_id: exam.id,
      dedupe_key: `seat:${exam.id}`,
      kind: 'check',
      paste_kind: 'seat',
      title: `Check Odyssey for your ${label} seat`,
      where_to_find: 'Odyssey (or Portal, Academics). Paste the row in the Inbox to save the room and seat.',
      url: ODYSSEY_URL,
      remind_at: at(addDaysToDate(toTorontoDate(examAt), -3), '09:00'),
      done: Boolean(exam.seat),
    });
  }

  out.push({
    ...base,
    dedupe_key: `finals_check:${term.code}`,
    kind: 'check',
    paste_kind: 'finals_check',
    title: 'Confirm your final exams were imported',
    where_to_find: 'The final exam schedule page. Paste your finals in the Inbox if Runway has none.',
    url: FINALS_URL,
    remind_at: at(FINALS_CHECK_ON, '09:00'),
    done: input.finalsImported,
  });

  return out;
}

export interface ExistingReminder {
  id: string;
  dedupe_key: string;
  title: string;
  where_to_find: string | null;
  url: string | null;
  remind_at: string;
  course_id: string | null;
  item_id: string | null;
  done_at: string | null;
}

export interface ReminderWrites {
  inserts: ReminderDraft[];
  updates: {
    id: string;
    patch: Partial<Omit<ExistingReminder, 'id' | 'dedupe_key'>>;
  }[];
}

/**
 * What the reminders job must write. New drafts are inserted unless already done;
 * open reminders follow their draft (an exam that moves moves its seat check) or
 * close when the draft is done; reminders Dylan closed are never reopened.
 */
export function planReminderWrites(existing: ExistingReminder[], drafts: ReminderDraft[], now: Date): ReminderWrites {
  const byKey = new Map(existing.map((r) => [r.dedupe_key, r]));
  const writes: ReminderWrites = { inserts: [], updates: [] };
  for (const d of drafts) {
    const row = byKey.get(d.dedupe_key);
    if (!row) {
      if (!d.done) writes.inserts.push(d);
      continue;
    }
    if (row.done_at) continue;
    if (d.done) {
      writes.updates.push({
        id: row.id,
        patch: { done_at: now.toISOString() },
      });
      continue;
    }
    const patch: ReminderWrites['updates'][number]['patch'] = {};
    if (row.title !== d.title) patch.title = d.title;
    if (row.where_to_find !== d.where_to_find) patch.where_to_find = d.where_to_find;
    if (row.url !== d.url) patch.url = d.url;
    if (new Date(row.remind_at).getTime() !== new Date(d.remind_at).getTime()) patch.remind_at = d.remind_at;
    if (row.course_id !== d.course_id) patch.course_id = d.course_id;
    if (row.item_id !== d.item_id) patch.item_id = d.item_id;
    if (Object.keys(patch).length) writes.updates.push({ id: row.id, patch });
  }
  // A seat check whose exam passed, was dismissed, or was deleted has no draft: close it.
  const drafted = new Set(drafts.map((d) => d.dedupe_key));
  for (const row of existing) {
    if (!row.done_at && row.dedupe_key.startsWith('seat:') && !drafted.has(row.dedupe_key)) {
      writes.updates.push({
        id: row.id,
        patch: { done_at: now.toISOString() },
      });
    }
  }
  return writes;
}
