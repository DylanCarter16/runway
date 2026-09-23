'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/db/admin';
import { createClient, requireUser } from '@/lib/db/server';
import type { ItemKind } from '@/config/term-f26';
import type { Json } from '@/lib/db/types';
import { disconnectGoogle } from '@/lib/jobs/gcal';
import { enqueueNow, runQueuedJobs, runWorkerNow } from '@/lib/jobs/schedule';
import { cleanReminders, ITEM_KIND_VALUES, resolveRule, type RuleOverrides } from '@/lib/reminders/rules';
import type { RunTarget } from '@/lib/jobs/types';
import { deleteLearnFeedUrl, saveLearnFeedUrl } from '@/lib/jobs/tokens';
import type { ActionResult } from '../actions';

// Settings actions that touch server-only tables (jobs, integration_tokens). Each
// checks the session first, then uses the service role through src/lib/jobs.

const targetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('learn_ics') }),
  z.object({ kind: z.literal('open_data') }),
  z.object({ kind: z.literal('calendar') }),
  z.object({ kind: z.literal('page'), pageId: z.uuid() }),
]);

export async function runSyncNow(target: RunTarget): Promise<ActionResult<{ queued: number }>> {
  const user = await requireUser();
  const parsed = targetSchema.safeParse(target);
  if (!parsed.success) return { ok: false, error: 'Unknown source.' };
  const admin = createAdminClient();
  try {
    const queued = await enqueueNow(admin, user.id, parsed.data);
    after(async () => {
      try {
        await runQueuedJobs(admin);
      } catch (e) {
        console.error('job worker failed:', e instanceof Error ? e.message : e);
      }
    });
    return { ok: true, data: { queued } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not start the sync.' };
  }
}

const feedSchema = z
  .string()
  .trim()
  .max(2000)
  .pipe(z.url({ protocol: /^https$/, error: 'Paste the full feed URL; it starts with https://' }));

export async function saveLearnFeed(url: string): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = feedSchema.safeParse(url);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the feed URL.' };
  const admin = createAdminClient();
  try {
    await saveLearnFeedUrl(admin, user.id, parsed.data);
    await enqueueNow(admin, user.id, { kind: 'learn_ics' });
    after(async () => {
      try {
        await runQueuedJobs(admin);
      } catch (e) {
        console.error('job worker failed:', e instanceof Error ? e.message : e);
      }
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save the feed URL.' };
  }
  revalidatePath('/settings', 'layout');
  return { ok: true, data: null };
}

export async function removeLearnFeed(): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await deleteLearnFeedUrl(createAdminClient(), user.id);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not remove the feed URL.' };
  }
  revalidatePath('/settings', 'layout');
  return { ok: true, data: null };
}

const aiSwitchSchema = z.object({
  courseId: z.uuid(),
  on: z.boolean(),
  confirmCode: z.string().max(40).optional(),
  instructorAllows: z.boolean().optional(),
});

/**
 * The course AI switch (SPEC 4.10). Turning it on needs the course code typed
 * out and a confirmation that the instructor allows AI for this use.
 */
export async function setCourseAi(input: z.infer<typeof aiSwitchSchema>): Promise<ActionResult> {
  const parsed = aiSwitchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Bad request.' };
  await requireUser();
  const supabase = await createClient();
  const { data: course } = await supabase.from('courses').select('id, code').eq('id', parsed.data.courseId).maybeSingle();
  if (!course) return { ok: false, error: 'That course no longer exists.' };
  if (parsed.data.on) {
    const typed = (parsed.data.confirmCode ?? '').replace(/\s+/g, '').toUpperCase();
    if (typed !== course.code.replace(/\s+/g, '').toUpperCase()) return { ok: false, error: `Type ${course.code} to confirm.` };
    if (!parsed.data.instructorAllows) return { ok: false, error: 'Confirm that the instructor allows AI for this use.' };
  }
  const { error } = await supabase.from('courses').update({ ai_allowed: parsed.data.on }).eq('id', course.id);
  if (error) return { ok: false, error: `Could not change the switch: ${error.message}` };
  revalidatePath('/', 'layout');
  return { ok: true, data: null };
}

export async function disconnectGoogleCalendar(): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await disconnectGoogle(user.id);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not disconnect Google Calendar.' };
  }
  revalidatePath('/', 'layout');
  return { ok: true, data: null };
}

const reminderSettingsSchema = z.object({
  studyBlockHour: z.number().int().min(0).max(23),
  rules: z.record(
    z.enum(ITEM_KIND_VALUES),
    z.object({
      prepDays: z.number().int().min(0).max(60),
      reminders: z.array(z.number().int().min(0).max(40320)).max(5),
    }),
  ),
});

/** Saves Settings, Reminders. Only kinds that differ from the defaults are stored. */
export async function saveReminderSettings(input: z.infer<typeof reminderSettingsSchema>): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = reminderSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the reminder values.' };
  const overrides: RuleOverrides = {};
  for (const [kind, rule] of Object.entries(parsed.data.rules) as [ItemKind, { prepDays: number; reminders: number[] }][]) {
    const base = resolveRule(kind, null);
    const reminders = cleanReminders(rule.reminders);
    const entry: { prepDays?: number; reminders?: number[] } = {};
    if (rule.prepDays !== base.prepDays) entry.prepDays = rule.prepDays;
    if (reminders.join() !== base.reminders.join()) entry.reminders = reminders;
    if (Object.keys(entry).length) overrides[kind] = entry;
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from('settings')
    .upsert({ user_id: user.id, study_block_hour: parsed.data.studyBlockHour, reminder_rules: overrides as Json }, { onConflict: 'user_id' });
  if (error) return { ok: false, error: `Could not save: ${error.message}` };
  // Every event may change: reconcile the calendar.
  await enqueueNow(createAdminClient(), user.id, { kind: 'calendar' });
  after(runWorkerNow);
  revalidatePath('/settings', 'layout');
  return { ok: true, data: null };
}
