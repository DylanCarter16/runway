import { after } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/db/admin';
import { isCronRequest } from '@/lib/jobs/cron-auth';
import { enqueueCadence, runQueuedJobs } from '@/lib/jobs/schedule';

// Enqueues the syncs for one cadence, then starts the worker after the response.

export const maxDuration = 60;

const setSchema = z.enum(['hourly', 'every_3h', 'daily']);

export async function POST(request: Request) {
  if (!isCronRequest(request)) return new Response('Unauthorized', { status: 401 });
  const set = setSchema.safeParse(new URL(request.url).searchParams.get('set'));
  if (!set.success) return Response.json({ error: 'set must be hourly, every_3h, or daily' }, { status: 400 });

  const admin = createAdminClient();
  const queued = await enqueueCadence(admin, set.data);
  after(async () => {
    try {
      await runQueuedJobs(admin);
    } catch (e) {
      console.error('job worker failed:', e instanceof Error ? e.message : e);
    }
  });
  return Response.json({ set: set.data, queued }, { status: 202 });
}
