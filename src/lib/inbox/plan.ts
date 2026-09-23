import { tidyDraft, type GradesResult, type ItemDraft, type OutlineResult, type AnnouncementResult } from '@/lib/ai/schemas';
import type { ParsedMark } from '@/lib/grades/parse';
import { titleKey } from '@/lib/items/title-key';
import type { OdysseyRow } from '@/lib/sources/odyssey';
import type { QuestCourse } from '@/lib/sources/quest';
import { daysBetweenDates, fromTorontoLocal, toTorontoDate, toTorontoTime } from '@/lib/time';
import type {
  CourseCtx,
  CourseInfoPayload,
  CreateItemPayload,
  ItemCtx,
  ItemFields,
  PlannedProposal,
  UpdateItemPayload,
} from './types';

// Pure planning: turns parser and Claude output into review-queue proposals.
// Nothing here writes to items; approval does (src/lib/inbox/apply.ts).

const TIMING = ['due_at', 'starts_at', 'ends_at', 'all_day', 'time_known'] as const;

export function normalizeCode(code: string): string {
  return code.replace(/\s+/g, '').toUpperCase();
}

export function courseByCode(courses: CourseCtx[], code: string): CourseCtx | undefined {
  const want = normalizeCode(code);
  return courses.find((c) => normalizeCode(c.code) === want);
}

export { titleKey };

function similarTitle(a: string, b: string): boolean {
  const x = titleKey(a);
  const y = titleKey(b);
  if (!x || !y) return false;
  return x === y || (x.length >= 3 && y.startsWith(x)) || (y.length >= 3 && x.startsWith(y));
}

function itemDate(item: ItemCtx): string | null {
  const at = item.due_at ?? item.starts_at;
  return at ? toTorontoDate(new Date(at)) : null;
}

/** Timing columns for a local date, optional start time, and optional end time. */
export function timingFor(date: string | null, time: string | null, endTime: string | null = null): ItemFields {
  if (!date) return { due_at: null, starts_at: null, ends_at: null, all_day: true, time_known: false };
  const at = fromTorontoLocal(date, time).toISOString();
  if (!time) return { due_at: at, starts_at: null, ends_at: null, all_day: true, time_known: false };
  return {
    due_at: at,
    starts_at: endTime ? at : null,
    ends_at: endTime ? fromTorontoLocal(date, endTime).toISOString() : null,
    all_day: false,
    time_known: true,
  };
}

function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return (a ?? null) === (b ?? null);
  return new Date(a).getTime() === new Date(b).getTime();
}

/**
 * Changes a draft makes to an existing item. Only non-null draft fields count,
 * and a date without a time never erases a known time on the same day.
 */
export function draftChanges(item: ItemCtx, draft: ItemDraft): { changes: ItemFields; before: ItemFields } {
  const changes: ItemFields = {};
  const before: ItemFields = {};
  if (draft.date) {
    const sameDayKnownTime = !draft.time && item.time_known && itemDate(item) === draft.date;
    if (!sameDayKnownTime) {
      const next = timingFor(draft.date, draft.time, draft.end_time);
      if (!draft.end_time && item.starts_at && next.time_known) {
        // Keep an exam's length when only its start moves.
        const length = item.ends_at ? new Date(item.ends_at).getTime() - new Date(item.starts_at).getTime() : 0;
        next.starts_at = next.due_at;
        next.ends_at = length ? new Date(new Date(next.due_at!).getTime() + length).toISOString() : null;
      }
      const differs = TIMING.some((f) =>
        typeof next[f] === 'boolean' ? next[f] !== item[f] : !sameInstant(next[f] as string | null, item[f] as string | null),
      );
      if (differs) {
        for (const f of TIMING) {
          (changes as Record<string, unknown>)[f] = next[f];
          (before as Record<string, unknown>)[f] = item[f];
        }
      }
    }
  }
  if (draft.location && draft.location !== item.location) {
    changes.location = draft.location;
    before.location = item.location;
  }
  if (draft.seat && draft.seat !== item.seat) {
    changes.seat = draft.seat;
    before.seat = item.seat;
  }
  if (draft.weight_percent !== null && Number(draft.weight_percent) !== (item.weight_percent === null ? null : Number(item.weight_percent))) {
    changes.weight_percent = draft.weight_percent;
    before.weight_percent = item.weight_percent;
  }
  return { changes, before };
}

/**
 * SPEC 4.4 duplicate check: same course and kind, similar title, and dates
 * within 3 days (or one side undated).
 */
export function findDuplicate(items: ItemCtx[], courseId: string | null, draft: ItemDraft): ItemCtx | undefined {
  return items.find((i) => {
    if (i.state !== 'active' || i.course_id !== courseId || i.kind !== draft.kind) return false;
    if (!similarTitle(i.title, draft.title)) return false;
    const d = itemDate(i);
    if (!d || !draft.date) return true;
    return Math.abs(daysBetweenDates(d, draft.date)) <= 3;
  });
}

export interface DraftContext {
  courses: CourseCtx[];
  items: ItemCtx[];
  /** The course the paste was filed under; drafts without a known slug fall back to it. */
  defaultCourseId: string | null;
  source: string;
  sourceUrl?: string | null;
}

function updateProposal(item: ItemCtx, draft: ItemDraft, source: string): PlannedProposal | null {
  const { changes, before } = draftChanges(item, draft);
  if (!Object.keys(changes).length) return null;
  const payload: UpdateItemPayload = { source, title: item.title, changes, before };
  return {
    course_id: item.course_id,
    kind: 'update_item',
    target_item_id: item.id,
    payload,
    evidence: draft.evidence || null,
    confidence: draft.confidence,
  };
}

/** One draft becomes a create proposal, an update proposal, or nothing (no change). */
export function draftToProposal(raw: ItemDraft, ctx: DraftContext): PlannedProposal | null {
  const draft = tidyDraft(raw);
  const course = draft.course_slug ? ctx.courses.find((c) => c.slug === draft.course_slug) : undefined;
  const courseId = course?.id ?? ctx.defaultCourseId;

  const matched = draft.match_item_id ? ctx.items.find((i) => i.id === draft.match_item_id && i.state === 'active') : undefined;
  const target = matched ?? findDuplicate(ctx.items, courseId, draft);
  if (target) return updateProposal(target, draft, ctx.source);
  if (!draft.title) return null;

  const item: ItemFields = {
    course_id: courseId,
    kind: draft.kind,
    title: draft.title,
    ...timingFor(draft.date, draft.time, draft.end_time),
    location: draft.location,
    seat: draft.seat,
    weight_percent: draft.weight_percent,
    source_url: ctx.sourceUrl ?? null,
  };
  const payload: CreateItemPayload = { source: ctx.source, item };
  return {
    course_id: courseId,
    kind: 'create_item',
    target_item_id: null,
    payload,
    evidence: draft.evidence || null,
    confidence: draft.confidence,
  };
}

/** Drafts in order, with later drafts that repeat an earlier one dropped. */
export function draftsToProposals(drafts: ItemDraft[], ctx: DraftContext): PlannedProposal[] {
  const out: PlannedProposal[] = [];
  const seenTargets = new Set<string>();
  const seenCreates = new Set<string>();
  for (const d of drafts) {
    const p = draftToProposal(d, ctx);
    if (!p) continue;
    if (p.target_item_id) {
      if (seenTargets.has(p.target_item_id)) continue;
      seenTargets.add(p.target_item_id);
    } else {
      const item = (p.payload as CreateItemPayload).item;
      const key = `${item.course_id}|${item.kind}|${titleKey(item.title ?? '')}`;
      if (seenCreates.has(key)) continue;
      seenCreates.add(key);
    }
    out.push(p);
  }
  return out;
}

function infoProposal(courseId: string | null, payload: CourseInfoPayload, evidence: string | null): PlannedProposal {
  return { course_id: courseId, kind: 'course_info', target_item_id: null, payload, evidence, confidence: null };
}

const INFO_HEADINGS: Record<string, string> = {
  missed_work_policy: 'Missed work',
  collaboration_policy: 'Collaboration',
  required_materials: 'Required materials',
  office_hours: 'Office hours',
  staff: 'Staff',
  other: 'Other',
};

/** Policy and course info entries from the outline and announcement prompts. */
export function infoToProposals(
  courseId: string | null,
  entries: { field: string; value: string; evidence: string }[],
): PlannedProposal[] {
  const out: PlannedProposal[] = [];
  for (const e of entries) {
    const value = e.value.trim();
    if (!value) continue;
    const evidence = e.evidence.slice(0, 200) || null;
    if (e.field === 'late_policy' || e.field === 'remark_policy' || e.field === 'ai_policy') {
      out.push(infoProposal(courseId, { field: e.field, value }, evidence));
    } else if (e.field === 'submission_platforms') {
      const list = value.split(/,|;|\band\b|\//).map((s) => s.trim()).filter(Boolean);
      if (list.length) out.push(infoProposal(courseId, { field: 'submission_platforms', value: list }, evidence));
    } else {
      out.push(infoProposal(courseId, { field: 'info_notes', heading: INFO_HEADINGS[e.field] ?? 'Other', value }, evidence));
    }
  }
  return out;
}

export function outlineToProposals(result: OutlineResult, ctx: DraftContext): PlannedProposal[] {
  const courseId = (result.course_slug && ctx.courses.find((c) => c.slug === result.course_slug)?.id) || ctx.defaultCourseId;
  const scoped = { ...ctx, defaultCourseId: courseId };
  const out = draftsToProposals(result.assessments, scoped);
  out.push(...infoToProposals(courseId, result.policies));
  if (result.grading_scheme.length) {
    out.push(
      infoProposal(
        courseId,
        {
          field: 'grading_scheme',
          value: result.grading_scheme.map((g) => ({ component: g.component.trim(), weight_percent: g.weight_percent, notes: g.notes })),
        },
        null,
      ),
    );
  }
  if (result.contacts.length) {
    out.push(
      infoProposal(
        courseId,
        { field: 'staff', value: result.contacts.map((c) => ({ name: c.name, role: c.role, email: c.email, office: null, notes: null })) },
        null,
      ),
    );
  }
  if (result.office_hours.length) {
    out.push(infoProposal(courseId, { field: 'office_hours', value: result.office_hours.map((o) => ({ ...o })) }, null));
  }
  return out;
}

export function announcementToProposals(result: AnnouncementResult, ctx: DraftContext): PlannedProposal[] {
  const courseId = (result.course_slug && ctx.courses.find((c) => c.slug === result.course_slug)?.id) || ctx.defaultCourseId;
  const scoped = { ...ctx, defaultCourseId: courseId, sourceUrl: result.post_url ?? ctx.sourceUrl };
  return [...draftsToProposals(result.items, scoped), ...infoToProposals(courseId, result.course_info)];
}

function meetingKey(m: unknown): string {
  const x = m as Record<string, unknown>;
  return JSON.stringify([x.component, x.section, x.days, x.start, x.end, x.location, x.starts_on, x.ends_on]);
}

/** One meeting proposal per known course whose meetings differ from what is stored. */
export function questToProposals(parsed: QuestCourse[], courses: CourseCtx[]): { proposals: PlannedProposal[]; unknownCodes: string[] } {
  const proposals: PlannedProposal[] = [];
  const unknownCodes: string[] = [];
  for (const qc of parsed) {
    const course = courseByCode(courses, qc.code);
    if (!course) {
      unknownCodes.push(qc.code);
      continue;
    }
    const current = Array.isArray(course.meetings) ? (course.meetings as unknown[]).map(meetingKey).sort() : [];
    const next = qc.meetings.map(meetingKey).sort();
    if (JSON.stringify(current) === JSON.stringify(next)) continue;
    proposals.push({
      course_id: course.id,
      kind: 'meeting',
      target_item_id: null,
      payload: { course_code: course.code, meetings: qc.meetings },
      evidence: `${qc.code} - ${qc.title}: ${qc.meetings.length} class meetings`,
      confidence: 1,
    });
  }
  return { proposals, unknownCodes };
}

/**
 * Picks the exam a row is about: same course, kind midterm or final (the row's
 * kind when it names one), on the row's date, else the nearest within 14 days.
 */
export function matchExam(items: ItemCtx[], courseId: string, row: OdysseyRow): ItemCtx | undefined {
  const exams = items.filter(
    (i) => i.state === 'active' && i.course_id === courseId && (row.kind ? i.kind === row.kind : i.kind === 'midterm' || i.kind === 'final'),
  );
  if (!row.date) return exams.length === 1 ? exams[0] : undefined;
  let best: ItemCtx | undefined;
  let bestGap = Infinity;
  for (const e of exams) {
    const d = itemDate(e);
    if (!d) continue;
    const gap = Math.abs(daysBetweenDates(d, row.date));
    if (gap < bestGap) {
      best = e;
      bestGap = gap;
    }
  }
  return bestGap <= 14 ? best : undefined;
}

export function odysseyToProposals(rows: OdysseyRow[], courses: CourseCtx[], items: ItemCtx[]): { proposals: PlannedProposal[]; unknownCodes: string[] } {
  const proposals: PlannedProposal[] = [];
  const unknownCodes: string[] = [];
  for (const row of rows) {
    const course = courseByCode(courses, row.courseCode);
    if (!course) {
      unknownCodes.push(row.courseCode);
      continue;
    }
    const draft: ItemDraft = {
      action: 'update',
      match_item_id: null,
      course_slug: course.slug,
      kind: row.kind ?? 'midterm',
      title: row.kind === 'final' ? 'Final exam' : 'Midterm',
      date: row.date,
      time: row.start,
      end_time: row.end,
      location: row.location,
      seat: row.seat,
      weight_percent: null,
      evidence: row.raw,
      confidence: 1,
    };
    const target = matchExam(items, course.id, row);
    const p = target ? updateProposal(target, draft, 'paste') : draftToProposal(draft, { courses, items: [], defaultCourseId: course.id, source: 'paste' });
    if (p) proposals.push(p);
  }
  return { proposals, unknownCodes };
}

export function gradesToProposals(result: GradesResult, ctx: DraftContext): PlannedProposal[] {
  return result.grades.map((g) => {
    const course = g.course_slug ? ctx.courses.find((c) => c.slug === g.course_slug) : undefined;
    const item = g.match_item_id ? ctx.items.find((i) => i.id === g.match_item_id) : undefined;
    return {
      course_id: course?.id ?? item?.course_id ?? ctx.defaultCourseId,
      kind: 'grade' as const,
      target_item_id: item?.id ?? null,
      payload: { label: g.label.trim(), score: g.score, out_of: g.out_of, item_id: item?.id ?? null },
      evidence: g.evidence.slice(0, 200) || null,
      confidence: null,
    };
  });
}

/** Marks read by the rule-based parser, matched to the course's items by title. */
export function marksToProposals(marks: ParsedMark[], courseId: string, items: ItemCtx[]): PlannedProposal[] {
  const courseItems = items.filter((i) => i.course_id === courseId && i.state === 'active');
  return marks.map((m) => {
    const key = titleKey(m.label);
    const item = courseItems.find((i) => titleKey(i.title) === key);
    return {
      course_id: courseId,
      kind: 'grade' as const,
      target_item_id: item?.id ?? null,
      payload: { label: m.label, score: m.score, out_of: m.out_of, item_id: item?.id ?? null },
      evidence: m.raw.slice(0, 200),
      confidence: 1,
    };
  });
}

/** Existing items as the prompt's <existing_items> list. */
export function contextItems(items: ItemCtx[], courses: CourseCtx[], courseId: string | null) {
  const slugOf = new Map(courses.map((c) => [c.id, c.slug]));
  return items
    .filter((i) => i.state === 'active' && (!courseId || i.course_id === courseId))
    .map((i) => {
      const at = i.due_at ?? i.starts_at;
      return {
        id: i.id,
        courseSlug: i.course_id ? (slugOf.get(i.course_id) ?? null) : null,
        kind: i.kind,
        title: i.title,
        date: at ? toTorontoDate(new Date(at)) : null,
        time: at && i.time_known ? toTorontoTime(new Date(at)) : null,
      };
    });
}
