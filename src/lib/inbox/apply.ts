import { z } from 'zod';
import type { TablesInsert, TablesUpdate } from '@/lib/db/types';
import { ITEM_KINDS } from '@/lib/items/labels';
import { timingFor } from './plan';
import type { CourseInfoPayload, CreateItemPayload, GradePayload, ItemFields, MeetingPayload, UpdateItemPayload } from './types';

// What approving a proposal writes (SPEC 4.4, Phase 3 task 5). Pure: the
// server action runs the returned writes with Dylan's session, so RLS applies.

const ITEM_SOURCES = [
  'manual', 'seed', 'learn_ics', 'cs251_schedule', 'cs251_examinfo', 'cs251_assignments', 'open_data',
  'paste', 'piazza_email', 'crowdmark_email', 'note', 'page_diff',
];
const TIMING = ['due_at', 'starts_at', 'ends_at', 'all_day', 'time_known'];

export interface ProposalRecord {
  id: string;
  kind: string;
  course_id: string | null;
  target_item_id: string | null;
  source_document_id: string | null;
  payload: unknown;
}

export interface TargetItem {
  id: string;
  course_id: string | null;
  kind: string;
  title: string;
  due_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  all_day: boolean;
  time_known: boolean;
  location: string | null;
  seat: string | null;
  weight_percent: number | null;
  locked_fields: string[];
}

export interface TargetCourse {
  id: string;
  info_notes: string | null;
}

/** "Edit then approve": the item form's fields, or a new text value for course info. */
export const approvalEditSchema = z.union([
  z.object({
    type: z.literal('item'),
    courseId: z.uuid().nullable(),
    kind: z.enum(ITEM_KINDS as [string, ...string[]]),
    title: z.string().trim().min(1, 'Add a title').max(200),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-09-30').nullable(),
    time: z.string().regex(/^\d{2}:\d{2}$/, 'Use a time like 17:00').nullable(),
    location: z.string().trim().max(200).nullable(),
    seat: z.string().trim().max(100).nullable(),
    weight: z.number().min(0).max(100).nullable(),
  }),
  z.object({ type: z.literal('text'), value: z.string().trim().min(1, 'Add a value').max(5000) }),
]);
export type ApprovalEdit = z.infer<typeof approvalEditSchema>;

export interface ApprovalWrites {
  insertItem?: TablesInsert<'items'>;
  updateItem?: { id: string; patch: TablesUpdate<'items'> };
  updateCourse?: { id: string; patch: TablesUpdate<'courses'> };
  insertGrade?: TablesInsert<'grades'>;
}

export class ApprovalError extends Error {}

function sameInstant(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return (a ?? null) === (b ?? null);
  return new Date(a).getTime() === new Date(b).getTime();
}

/** Item columns from the edit form. Exams keep their length when the start is known. */
function fieldsFromEdit(edit: Extract<ApprovalEdit, { type: 'item' }>, length: number | null): ItemFields {
  const timing = timingFor(edit.date, edit.time);
  if (timing.time_known && length) {
    timing.starts_at = timing.due_at;
    timing.ends_at = new Date(new Date(timing.due_at!).getTime() + length).toISOString();
  }
  return {
    course_id: edit.courseId,
    kind: edit.kind,
    title: edit.title,
    ...timing,
    location: edit.location || null,
    seat: edit.seat || null,
    weight_percent: edit.weight,
  };
}

function lengthOf(f: { starts_at?: string | null; ends_at?: string | null }): number | null {
  return f.starts_at && f.ends_at ? new Date(f.ends_at).getTime() - new Date(f.starts_at).getTime() : null;
}

/** Only the item columns a proposal may write. */
function pickItemFields(f: ItemFields): ItemFields {
  const allowed: (keyof ItemFields)[] = [
    'course_id', 'kind', 'title', 'description', 'due_at', 'starts_at', 'ends_at', 'all_day', 'time_known',
    'location', 'seat', 'weight_percent', 'source_url', 'flags',
  ];
  return Object.fromEntries(Object.entries(f).filter(([k, v]) => allowed.includes(k as keyof ItemFields) && v !== undefined)) as ItemFields;
}

function changeSource(source: string | undefined): string {
  return source && ITEM_SOURCES.includes(source) && source !== 'seed' && source !== 'manual' ? source : 'paste';
}

export function planApproval(
  p: ProposalRecord,
  ctx: { userId: string; target?: TargetItem | null; course?: TargetCourse | null },
  edit?: ApprovalEdit,
): ApprovalWrites {
  switch (p.kind) {
    case 'create_item': {
      const payload = p.payload as CreateItemPayload;
      let item = pickItemFields(payload.item);
      if (edit?.type === 'item') item = { ...item, ...fieldsFromEdit(edit, lengthOf(item)) };
      if (!item.title || !item.kind) throw new ApprovalError('This proposal has no title or kind.');
      const source = changeSource(payload.source);
      return {
        insertItem: {
          ...item,
          user_id: ctx.userId,
          kind: item.kind,
          title: item.title,
          course_id: item.course_id ?? p.course_id,
          source,
          source_ref: payload.source_ref ?? `paste:${p.id}`,
          source_document_id: p.source_document_id,
          last_change_source: source,
        },
      };
    }
    case 'update_item': {
      const target = ctx.target;
      if (!target) throw new ApprovalError('That item no longer exists.');
      const payload = p.payload as UpdateItemPayload;
      let changes = pickItemFields(payload.changes);
      if (edit?.type === 'item') {
        const next = fieldsFromEdit(edit, lengthOf(target));
        changes = {};
        for (const [k, v] of Object.entries(next) as [keyof TargetItem & keyof ItemFields, unknown][]) {
          const same = k.endsWith('_at') ? sameInstant(target[k], v) : (target[k] ?? null) === (v ?? null);
          if (!same) (changes as Record<string, unknown>)[k] = v;
        }
        // The timing group moves together.
        if (TIMING.some((f) => f in changes)) for (const f of TIMING) (changes as Record<string, unknown>)[f] = (next as Record<string, unknown>)[f];
      }
      const changed = Object.keys(changes);
      const unlock = new Set(changed.some((f) => TIMING.includes(f)) ? [...changed, ...TIMING] : changed);
      return {
        updateItem: {
          id: target.id,
          patch: {
            ...changes,
            locked_fields: target.locked_fields.filter((f) => !unlock.has(f)),
            last_change_source: changeSource(payload.source),
          },
        },
      };
    }
    case 'course_info': {
      const course = ctx.course;
      if (!course) throw new ApprovalError('This proposal has no course. Dismiss it, or paste again with a course.');
      const payload = p.payload as CourseInfoPayload;
      const text = edit?.type === 'text' ? edit.value : null;
      switch (payload.field) {
        case 'late_policy':
        case 'remark_policy':
        case 'ai_policy':
          return { updateCourse: { id: course.id, patch: { [payload.field]: text ?? payload.value } } };
        case 'info_notes': {
          const add = `${payload.heading}: ${text ?? payload.value}`;
          const current = course.info_notes?.trim();
          return { updateCourse: { id: course.id, patch: { info_notes: current ? `${current}\n\n${add}` : add } } };
        }
        case 'submission_platforms':
          return {
            updateCourse: {
              id: course.id,
              patch: { submission_platforms: text ? text.split(',').map((s) => s.trim()).filter(Boolean) : payload.value },
            },
          };
        case 'grading_scheme':
        case 'staff':
        case 'office_hours':
          return { updateCourse: { id: course.id, patch: { [payload.field]: payload.value as unknown as TablesUpdate<'courses'>['staff'] } } };
      }
      throw new ApprovalError('Unknown course field.');
    }
    case 'meeting': {
      if (!ctx.course) throw new ApprovalError('That course no longer exists.');
      const payload = p.payload as MeetingPayload;
      return { updateCourse: { id: ctx.course.id, patch: { meetings: payload.meetings as unknown as TablesUpdate<'courses'>['meetings'] } } };
    }
    case 'grade': {
      const payload = p.payload as GradePayload;
      const courseId = ctx.target?.course_id ?? p.course_id;
      if (!courseId) throw new ApprovalError('This grade has no course. Dismiss it, or paste again with a course.');
      const writes: ApprovalWrites = {
        insertGrade: {
          user_id: ctx.userId,
          course_id: courseId,
          item_id: ctx.target?.id ?? null,
          label: payload.label,
          score: payload.score,
          out_of: payload.out_of,
          weight_percent: ctx.target?.weight_percent ?? null,
          source: 'paste',
          source_document_id: p.source_document_id,
        },
      };
      if (ctx.target) writes.updateItem = { id: ctx.target.id, patch: { progress: 'graded', last_change_source: 'paste' } };
      return writes;
    }
  }
  throw new ApprovalError(`Proposals of kind ${p.kind} can't be approved here yet.`);
}
