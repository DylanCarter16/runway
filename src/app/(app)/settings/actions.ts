'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/db/admin';
import { requireUser } from '@/lib/db/server';
import { enqueueNow, runQueuedJobs } from '@/lib/jobs/schedule';
import type { RunTarget } from '@/lib/jobs/types';
import { deleteLearnFeedUrl, saveLearnFeedUrl } from '@/lib/jobs/tokens';
import type { ActionResult } from '../actions';

// Settings actions that touch server-only tables (jobs, integration_tokens). Each
// checks the session first, then uses the service role through src/lib/jobs.

const targetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('learn_ics') }),
  z.object({ kind: z.literal('open_data') }),
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
