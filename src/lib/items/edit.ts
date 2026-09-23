import { z } from 'zod';
import type { TablesUpdate } from '@/lib/db/types';
import { fromTorontoLocal } from '@/lib/time';
import { ITEM_KINDS } from './labels';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-09-30');
const time = z.string().regex(/^\d{2}:\d{2}$/, 'Use a time like 17:00');

export const itemFormSchema = z.object({
  courseId: z.uuid().nullable(),
  kind: z.enum(ITEM_KINDS as [string, ...string[]]),
  title: z.string().trim().min(1, 'Add a title').max(200),
  date: date.nullable(),
  time: time.nullable(),
  weight: z.number().min(0).max(100).nullable(),
  location: z.string().trim().max(200).nullable().optional(),
  seat: z.string().trim().max(100).nullable().optional(),
  description: z.string().trim().max(5000).nullable().optional(),
});

export type ItemForm = z.infer<typeof itemFormSchema>;

export interface ItemSnapshot {
  course_id: string | null;
  kind: string;
  title: string;
  due_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  all_day: boolean;
  time_known: boolean;
  weight_percent: number | null;
  location: string | null;
  seat: string | null;
  description: string | null;
  locked_fields: string[];
}

/** Date fields for an item form: local midnight and all-day when the time is not set. */
export function whenFromForm(form: Pick<ItemForm, 'date' | 'time'>) {
  if (!form.date) return { due_at: null, all_day: true, time_known: false };
  const timeKnown = form.time !== null;
  return {
    due_at: fromTorontoLocal(form.date, form.time).toISOString(),
    all_day: !timeKnown,
    time_known: timeKnown,
  };
}

/**
 * The update for an edit form, plus the edited fields added to locked_fields
 * so later syncs propose changes instead of overwriting Dylan's edit.
 * Exams keep their duration when their date moves.
 */
export function buildItemUpdate(before: ItemSnapshot, form: ItemForm): TablesUpdate<'items'> {
  const when = whenFromForm(form);
  const next: TablesUpdate<'items'> = {
    course_id: form.courseId,
    kind: form.kind,
    title: form.title,
    ...when,
    weight_percent: form.weight,
    location: form.location ?? before.location,
    seat: form.seat ?? before.seat,
    description: form.description === undefined ? before.description : form.description,
  };

  if (before.starts_at && when.due_at && before.due_at !== when.due_at) {
    const shift = new Date(when.due_at).getTime() - new Date(before.due_at ?? before.starts_at).getTime();
    next.starts_at = new Date(new Date(before.starts_at).getTime() + shift).toISOString();
    if (before.ends_at) next.ends_at = new Date(new Date(before.ends_at).getTime() + shift).toISOString();
  }
  if (!when.due_at) {
    next.starts_at = null;
    next.ends_at = null;
  }

  const changed = (Object.keys(next) as (keyof TablesUpdate<'items'>)[]).filter((key) => {
    const a = (before as unknown as Record<string, unknown>)[key] ?? null;
    const b = next[key] ?? null;
    if (key === 'due_at' || key === 'starts_at' || key === 'ends_at') {
      return (a ? new Date(a as string).getTime() : null) !== (b ? new Date(b as string).getTime() : null);
    }
    return a !== b;
  });

  for (const key of Object.keys(next) as (keyof TablesUpdate<'items'>)[]) {
    if (!changed.includes(key)) delete next[key];
  }
  next.locked_fields = [...new Set([...before.locked_fields, ...changed])];
  next.last_change_source = 'manual';
  return next;
}
