import { z } from 'zod';

// Wire schemas for structured outputs (docs/PROMPTS.md). Every object lists all
// its properties as required and unknown values are null. Numeric and length
// limits stay out of these schemas (the API rejects some keywords); the clean-up
// step after parsing applies them.

export const ITEM_KIND_VALUES = [
  'assignment', 'quiz', 'midterm', 'final', 'project', 'tutorial', 'lab', 'reading', 'admin', 'break', 'other',
] as const;

export const itemDraft = z
  .object({
    action: z.enum(['create', 'update']),
    match_item_id: z.string().nullable(),
    course_slug: z.string().nullable(),
    kind: z.enum(ITEM_KIND_VALUES),
    title: z.string(),
    date: z.string().nullable().describe('YYYY-MM-DD in America/Toronto'),
    time: z.string().nullable().describe('HH:MM, 24-hour, local. null when the source gives no time'),
    end_time: z.string().nullable(),
    location: z.string().nullable(),
    seat: z.string().nullable(),
    weight_percent: z.number().nullable(),
    evidence: z.string().describe('Exact quote from the source, max 200 characters'),
    confidence: z.number().describe('0 to 1'),
  })
  .meta({ id: 'ItemDraft' });

export type ItemDraft = z.infer<typeof itemDraft>;

export const DOC_KINDS = [
  'outline', 'announcement', 'quest_schedule', 'odyssey_paste', 'grade_paste', 'assignment_header',
  'piazza_resources', 'crowdmark_assessment', 'lecture_notes', 'other',
] as const;
export type PasteKind = (typeof DOC_KINDS)[number];

export const classifyResult = z.object({
  kind: z.enum(DOC_KINDS),
  course_slug: z.string().nullable(),
  confidence: z.number(),
  reason: z.string(),
});

const infoEntry = <T extends readonly [string, ...string[]]>(fields: T) =>
  z.object({ field: z.enum(fields), value: z.string(), evidence: z.string() });

export const OUTLINE_POLICY_FIELDS = [
  'late_policy', 'remark_policy', 'ai_policy', 'missed_work_policy', 'collaboration_policy',
  'submission_platforms', 'required_materials', 'other',
] as const;

export const outlineResult = z.object({
  course_slug: z.string().nullable(),
  assessments: z.array(itemDraft),
  policies: z.array(infoEntry(OUTLINE_POLICY_FIELDS)),
  grading_scheme: z.array(
    z.object({ component: z.string(), weight_percent: z.number().nullable(), notes: z.string().nullable() }),
  ),
  contacts: z.array(z.object({ name: z.string(), role: z.string(), email: z.string().nullable() })),
  office_hours: z.array(z.object({ who: z.string(), when: z.string(), where: z.string().nullable() })),
});

export const IMPORTANCE = [
  'deadline_change', 'exam_info', 'assignment_release', 'marks_released', 'office_hours_change', 'general', 'noise',
] as const;

export const ANNOUNCEMENT_INFO_FIELDS = [
  'late_policy', 'remark_policy', 'ai_policy', 'office_hours', 'staff', 'submission_platforms', 'other',
] as const;

export const announcementResult = z.object({
  summary: z.string(),
  importance: z.enum(IMPORTANCE),
  course_slug: z.string().nullable(),
  items: z.array(itemDraft),
  course_info: z.array(infoEntry(ANNOUNCEMENT_INFO_FIELDS)),
  post_url: z.string().nullable(),
});

export const DAY_VALUES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export const questResult = z.object({
  meetings: z.array(
    z.object({
      course_code: z.string(),
      component: z.enum(['LEC', 'TUT', 'LAB', 'TST', 'SEM', 'OTHER']),
      section: z.string(),
      days: z.array(z.enum(DAY_VALUES)),
      start_time: z.string().nullable(),
      end_time: z.string().nullable(),
      location: z.string().nullable(),
      start_date: z.string().nullable(),
      end_date: z.string().nullable(),
    }),
  ),
  items: z.array(itemDraft),
});

export const itemsResult = z.object({ items: z.array(itemDraft) });

export const gradesResult = z.object({
  grades: z.array(
    z.object({
      course_slug: z.string().nullable(),
      label: z.string(),
      score: z.number().nullable(),
      out_of: z.number().nullable(),
      match_item_id: z.string().nullable(),
      evidence: z.string(),
    }),
  ),
});

export const diffSummaryResult = z.object({
  summary: z.string(),
  importance: z.enum(IMPORTANCE),
  course_slug: z.string().nullable(),
  items: z.array(itemDraft),
});

export const noteMetaResult = z.object({
  title: z.string(),
  topics: z.array(z.string()),
  summary: z.string(),
  open_questions: z.array(z.string()),
  items: z.array(itemDraft),
});

export const transcribeResult = z.object({
  pages: z.array(
    z.object({
      // Plain number: .int() adds bounds the API rejects. transcribePages rounds it.
      page: z.number(),
      markdown: z.string(),
      blank: z.boolean(),
    }),
  ),
});

export type TranscribeResult = z.infer<typeof transcribeResult>;
export type ClassifyResult = z.infer<typeof classifyResult>;
export type OutlineResult = z.infer<typeof outlineResult>;
export type AnnouncementResult = z.infer<typeof announcementResult>;
export type QuestResult = z.infer<typeof questResult>;
export type ItemsResult = z.infer<typeof itemsResult>;
export type GradesResult = z.infer<typeof gradesResult>;
export type DiffSummaryResult = z.infer<typeof diffSummaryResult>;
export type NoteMetaResult = z.infer<typeof noteMetaResult>;

/** JSON Schema for output_config.format, without the $schema key. */
export function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'output' }) as Record<string, unknown>;
  void _drop;
  return rest;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Applies the limits the wire schema leaves out: confidence in 0 to 1, evidence
 * at most 200 characters, dates and times in the expected format (else null),
 * weights in 0 to 100.
 */
export function tidyDraft(d: ItemDraft): ItemDraft {
  const time = d.time && TIME_RE.test(d.time) ? d.time : null;
  return {
    ...d,
    title: d.title.trim().slice(0, 200),
    date: d.date && DATE_RE.test(d.date) ? d.date : null,
    time,
    end_time: time && d.end_time && TIME_RE.test(d.end_time) ? d.end_time : null,
    weight_percent: d.weight_percent !== null && d.weight_percent >= 0 && d.weight_percent <= 100 ? d.weight_percent : null,
    evidence: d.evidence.slice(0, 200),
    confidence: Math.min(1, Math.max(0, Number.isFinite(d.confidence) ? d.confidence : 0)),
  };
}
