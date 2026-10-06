import type { SeedCourse, SeedItem, SeedLink, SeedMeeting, SeedPage, SeedTerm } from '@/config/term.template';
import type { TablesInsert, TablesUpdate } from '@/lib/db/types';
import { addDaysToDate, fromTorontoLocal } from '@/lib/time';

// Pure mappers from the term config to table rows. The importer in ./import.ts writes them.

export function termRow(term: SeedTerm, userId: string): TablesInsert<'terms'> {
  return {
    user_id: userId,
    code: term.code,
    name: term.name,
    starts_on: term.startsOn,
    ends_on: term.endsOn,
    is_current: true,
  };
}

function meetingJson(m: SeedMeeting) {
  return {
    component: m.component,
    section: m.section,
    class_number: m.classNumber,
    days: m.days,
    start: m.startTime,
    end: m.endTime,
    location: m.location,
    instructor: m.instructor ?? null,
    starts_on: m.startsOn,
    ends_on: m.endsOn,
  };
}

export function courseRow(
  course: SeedCourse,
  ctx: { userId: string; termId: string; sortOrder: number },
): TablesInsert<'courses'> {
  return {
    user_id: ctx.userId,
    term_id: ctx.termId,
    code: course.code,
    slug: course.slug,
    title: course.title,
    color: course.color,
    color_dark: course.colorDark,
    sort_order: ctx.sortOrder,
    site_url: course.siteUrl,
    outline_url: course.outlineUrl,
    submission_platforms: course.submissionPlatforms,
    late_policy: course.latePolicy,
    remark_policy: course.remarkPolicy,
    ai_policy: course.aiPolicy,
    ai_allowed: course.aiAllowed,
    grading_scheme: course.gradingScheme.map((g) => ({
      component: g.component,
      weight_percent: g.weightPercent,
      notes: g.notes ?? null,
    })),
    office_hours: course.officeHours.map((o) => ({ who: o.who, when: o.when, where: o.where ?? null })),
    staff: course.staff.map((s) => ({
      name: s.name,
      role: s.role,
      email: s.email ?? null,
      office: s.office ?? null,
      notes: s.notes ?? null,
    })),
    meetings: course.meetings.map(meetingJson),
    checklist: course.checklist,
    external_ids: { learn_names: course.learnNames },
    info_notes: course.infoNotes,
  };
}

export function linkRows(
  links: SeedLink[],
  ctx: { userId: string; courseId: string | null },
): TablesInsert<'links'>[] {
  return links.map((l, i) => ({
    user_id: ctx.userId,
    course_id: ctx.courseId,
    label: l.label,
    url: l.url,
    category: l.category,
    where_to_find: l.whereToFind ?? null,
    pinned: l.pinned ?? false,
    sort_order: i,
  }));
}

export function pageRows(
  pages: SeedPage[],
  ctx: { userId: string; courseId: string },
): TablesInsert<'watched_pages'>[] {
  return pages.map((p) => ({
    user_id: ctx.userId,
    course_id: ctx.courseId,
    url: p.url,
    label: p.label,
    parser: p.parser,
    cadence: p.cadence,
  }));
}

/**
 * One seed item as an items row. Date-only items store local midnight with
 * all_day = true and time_known = false. Timed items with a duration also get
 * starts_at and ends_at; multi-day items span to the end of their last day.
 */
export function itemRow(
  item: SeedItem,
  ctx: { userId: string; courseId: string | null; sourceUrl: string | null },
): TablesInsert<'items'> {
  let dueAt: string | null = null;
  let startsAt: string | null = null;
  let endsAt: string | null = null;
  const timeKnown = item.date !== null && item.time !== null;

  if (item.date) {
    const at = fromTorontoLocal(item.date, item.time);
    dueAt = at.toISOString();
    if (item.endDate) {
      startsAt = dueAt;
      endsAt = fromTorontoLocal(addDaysToDate(item.endDate, 1), null).toISOString();
    } else if (timeKnown && item.durationMinutes) {
      startsAt = dueAt;
      endsAt = new Date(at.getTime() + item.durationMinutes * 60_000).toISOString();
    }
  }

  return {
    user_id: ctx.userId,
    course_id: ctx.courseId,
    kind: item.kind,
    title: item.title,
    description: item.description ?? null,
    due_at: dueAt,
    starts_at: startsAt,
    ends_at: endsAt,
    all_day: !timeKnown,
    time_known: timeKnown,
    weight_percent: item.weightPercent ?? null,
    location: item.location ?? null,
    flags: item.flags ?? [],
    source: 'seed',
    source_ref: item.sourceRef,
    source_url: ctx.sourceUrl,
    last_change_source: 'seed',
  };
}

/** Item fields the term config owns. Reloading the setup brings these up to date. */
const SEED_FIELDS = [
  'kind',
  'title',
  'description',
  'due_at',
  'starts_at',
  'ends_at',
  'all_day',
  'time_known',
  'weight_percent',
  'location',
  'flags',
  'source_url',
] as const;

/** Moved together: locking any of them (an edit or an approved proposal) keeps all of them. */
const TIMING: readonly string[] = ['due_at', 'starts_at', 'ends_at', 'all_day', 'time_known'];

type SeedField = (typeof SEED_FIELDS)[number];
export type SeededItem = Pick<TablesInsert<'items'>, SeedField> & { locked_fields: string[] };

function sameValue(field: SeedField, a: unknown, b: unknown): boolean {
  if (field.endsWith('_at')) {
    return (a ? new Date(a as string).getTime() : null) === (b ? new Date(b as string).getTime() : null);
  }
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
  return (a ?? null) === (b ?? null);
}

/**
 * The update that brings an already-loaded seed item in line with the term config, or null
 * when nothing differs. Fields in locked_fields (Dylan's edits and approved proposals) are
 * left alone, and a locked timing field keeps the whole timing group.
 */
export function seedItemPatch(existing: SeededItem, next: TablesInsert<'items'>): TablesUpdate<'items'> | null {
  const locked = new Set(existing.locked_fields);
  const timingLocked = TIMING.some((f) => locked.has(f));
  const patch: Record<string, unknown> = {};
  for (const field of SEED_FIELDS) {
    if (locked.has(field)) continue;
    if (timingLocked && TIMING.includes(field)) continue;
    if (!sameValue(field, existing[field], next[field])) patch[field] = next[field] ?? null;
  }
  if (Object.keys(patch).length === 0) return null;
  return { ...(patch as TablesUpdate<'items'>), last_change_source: 'seed' };
}
