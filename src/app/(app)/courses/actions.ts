'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/db/server';
import { titleKey } from '@/lib/items/title-key';
import type { ActionResult } from '../actions';

// Grades tab: add a mark by hand, pick the component a mark counts toward, or
// remove a mark. Pasted marks arrive through the Inbox review queue instead.

const markSchema = z.object({
  courseId: z.string().uuid(),
  label: z.string().trim().min(1, 'Name the assessment.').max(120),
  score: z.number().min(0, 'The score can’t be negative.'),
  outOf: z.number().positive('"Out of" must be more than 0.'),
  component: z.string().trim().max(200).nullable(),
});

export async function addGrade(input: z.input<typeof markSchema>): Promise<ActionResult> {
  const parsed = markSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the mark.' };
  const user = await requireUser();
  const supabase = await createClient();
  const m = parsed.data;
  const { data: course } = await supabase.from('courses').select('id, slug').eq('id', m.courseId).maybeSingle();
  if (!course) return { ok: false, error: 'That course no longer exists.' };

  // Link the mark to the item with the same name ("A3", "Assignment 3") and mark it graded.
  const { data: items } = await supabase.from('items').select('id, title, weight_percent').eq('course_id', course.id).eq('state', 'active');
  const key = titleKey(m.label);
  const item = (items ?? []).find((i) => titleKey(i.title) === key) ?? null;

  const { error } = await supabase.from('grades').insert({
    user_id: user.id,
    course_id: course.id,
    item_id: item?.id ?? null,
    label: m.label,
    score: m.score,
    out_of: m.outOf,
    weight_percent: item?.weight_percent ?? null,
    component: m.component || null,
    source: 'manual',
  });
  if (error) return { ok: false, error: `Could not save: ${error.message}` };
  if (item) await supabase.from('items').update({ progress: 'graded', last_change_source: 'manual' }).eq('id', item.id);
  revalidatePath(`/courses/${course.slug}`, 'layout');
  return { ok: true, data: null };
}

const componentSchema = z.object({ id: z.string().uuid(), component: z.string().trim().max(200).nullable() });

export async function setGradeComponent(input: z.input<typeof componentSchema>): Promise<ActionResult> {
  const parsed = componentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the component.' };
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('grades')
    .update({ component: parsed.data.component || null })
    .eq('id', parsed.data.id)
    .select('courses(slug)')
    .maybeSingle();
  if (error) return { ok: false, error: `Could not save: ${error.message}` };
  if (!data) return { ok: false, error: 'That mark no longer exists.' };
  revalidatePath(`/courses/${data.courses?.slug ?? ''}`, 'layout');
  return { ok: true, data: null };
}

export async function deleteGrade(input: { id: string }): Promise<ActionResult> {
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the mark.' };
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.from('grades').delete().eq('id', parsed.data.id).select('courses(slug)').maybeSingle();
  if (error) return { ok: false, error: `Could not remove: ${error.message}` };
  revalidatePath(`/courses/${data?.courses?.slug ?? ''}`, 'layout');
  return { ok: true, data: null };
}
