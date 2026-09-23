'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/db/admin';
import { createClient, requireUser } from '@/lib/db/server';
import type { ItemKind } from '@/config/term-f26';
import type { Json } from '@/lib/db/types';
import { fileWaitingEmails } from '@/lib/jobs/email';
import { disconnectGoogle } from '@/lib/jobs/gcal';
import { enqueueNow, runQueuedJobs, runWorkerNow } from '@/lib/jobs/schedule';
import { cleanReminders, ITEM_KIND_VALUES, resolveRule, type RuleOverrides } from '@/lib/reminders/rules';
import type { RunTarget } from '@/lib/jobs/types';
import { createFeedToken, deleteFeedToken } from '@/lib/jobs/feed';
import { createOdysseyToken, deleteOdysseyToken } from '@/lib/jobs/odyssey';
import { deleteLearnFeedUrl, saveLearnFeedUrl } from '@/lib/jobs/tokens';
import { termDatedFilter } from '@/lib/term/range';
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

/** Turns the ICS feed on, or replaces its link (the old URL stops working). */
export async function makeFeedLink(): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await createFeedToken(createAdminClient(), user.id);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not make the feed link.' };
  }
  revalidatePath('/settings', 'layout');
  return { ok: true, data: null };
}

export async function turnOffFeed(): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await deleteFeedToken(createAdminClient(), user.id);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not turn off the feed.' };
  }
  revalidatePath('/settings', 'layout');
  return { ok: true, data: null };
}

/** Turns the Odyssey userscript on, or replaces its token (scripts with the old one stop working). */
export async function makeOdysseyToken(): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await createOdysseyToken(createAdminClient(), user.id);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not make the userscript token.' };
  }
  revalidatePath('/settings', 'layout');
  return { ok: true, data: null };
}

export async function turnOffOdysseyScript(): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await deleteOdysseyToken(createAdminClient(), user.id);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not turn off the userscript.' };
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

const noteStyleSchema = z.object({ style: z.string().trim().max(1000, 'Keep the style under 1,000 characters.') });

/** Settings, AI: the note cleanup style. Empty means the default from docs/PROMPTS.md. */
export async function saveNoteStyle(input: { style: string }): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = noteStyleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the style.' };
  const supabase = await createClient();
  const { error } = await supabase
    .from('settings')
    .upsert({ user_id: user.id, note_style_prompt: parsed.data.style || null }, { onConflict: 'user_id' });
  if (error) return { ok: false, error: `Could not save: ${error.message}` };
  revalidatePath('/settings', 'layout');
  return { ok: true, data: null };
}

const askSettingsSchema = z.object({
  style: z.string().trim().max(1000, 'Keep the style under 1,000 characters.'),
  budget: z.coerce
    .number()
    .int('Use a whole number of tokens.')
    .min(5000, 'Use at least 5,000 tokens.')
    .max(200000, 'Use at most 200,000 tokens.'),
});

/** Settings, AI: Ask's answer style and context budget (SPEC 5). */
export async function saveAskSettings(input: { style: string; budget: number | string }): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = askSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the settings.' };
  const supabase = await createClient();
  const { error } = await supabase
    .from('settings')
    .upsert({ user_id: user.id, answer_style_prompt: parsed.data.style || null, ask_context_budget: parsed.data.budget }, { onConflict: 'user_id' });
  if (error) return { ok: false, error: `Could not save: ${error.message}` };
  revalidatePath('/settings', 'layout');
  return { ok: true, data: null };
}

const piazzaMapSchema = z.object({
  map: z.record(z.string().regex(/^[a-z0-9]{8,24}$/), z.string().max(40)),
});

/**
 * Settings, Courses: which course each Piazza class belongs to (SETUP step 9).
 * Emails that arrived before their class was mapped move to the course and get read.
 */
export async function savePiazzaMap(input: { map: Record<string, string> }): Promise<ActionResult<{ moved: number }>> {
  const user = await requireUser();
  const parsed = piazzaMapSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the Piazza classes.' };
  const supabase = await createClient();
  const { data: courses } = await supabase.from('courses').select('slug').eq('archived', false);
  const slugs = new Set((courses ?? []).map((c) => c.slug));
  const map: Record<string, string> = {};
  for (const [nid, slug] of Object.entries(parsed.data.map)) {
    if (!slug) continue;
    if (!slugs.has(slug)) return { ok: false, error: `No course named ${slug}.` };
    map[nid] = slug;
  }
  const { error } = await supabase.from('settings').upsert({ user_id: user.id, piazza_map: map }, { onConflict: 'user_id' });
  if (error) return { ok: false, error: `Could not save: ${error.message}` };
  const admin = createAdminClient();
  let moved = 0;
  try {
    moved = await fileWaitingEmails(admin, user.id);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Saved, but waiting emails could not be filed.' };
  }
  if (moved) after(runWorkerNow);
  revalidatePath('/settings', 'layout');
  return { ok: true, data: { moved } };
}

const deleteTermSchema = z.object({ termId: z.uuid(), confirmName: z.string().max(200) });

/**
 * Settings, Data: delete a term with its courses, and through them its items, links,
 * grades, reminders, and watched pages. Notes and pasted documents stay (they lose
 * their course). Needs the term's name typed out.
 */
export async function deleteTerm(input: z.infer<typeof deleteTermSchema>): Promise<ActionResult<{ courses: number; items: number }>> {
  const parsed = deleteTermSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Bad request.' };
  await requireUser();
  const supabase = await createClient();
  const { data: term } = await supabase.from('terms').select('id, name, starts_on, ends_on').eq('id', parsed.data.termId).maybeSingle();
  if (!term) return { ok: false, error: 'That term no longer exists.' };
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  if (norm(parsed.data.confirmName) !== norm(term.name)) return { ok: false, error: `Type ${term.name} to confirm.` };
  const { data: courses } = await supabase.from('courses').select('id').eq('term_id', term.id);
  const ids = (courses ?? []).map((c) => c.id);
  const { count } = ids.length
    ? await supabase.from('items').select('id', { count: 'exact', head: true }).in('course_id', ids)
    : { count: 0 };
  // Course-less items dated in the term (reading week, exam period) go too.
  const { data: termWide, error: itemsError } = await supabase.from('items').delete().is('course_id', null).or(termDatedFilter(term)).select('id');
  if (itemsError) return { ok: false, error: `Could not delete the term's dates: ${itemsError.message}` };
  const { error } = await supabase.from('terms').delete().eq('id', term.id);
  if (error) return { ok: false, error: `Could not delete the term: ${error.message}` };
  revalidatePath('/', 'layout');
  return { ok: true, data: { courses: ids.length, items: (count ?? 0) + (termWide?.length ?? 0) } };
}
