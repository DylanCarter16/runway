import { after } from 'next/server';
import { createAdminClient } from '@/lib/db/admin';
import { isCronRequest } from '@/lib/jobs/cron-auth';
import { runQueuedJobs } from '@/lib/jobs/schedule';

// Job worker. Supabase Cron calls it every minute (docs/SETUP.md step 5). It answers
// 202 at once and processes ready jobs after the response.

export const maxDuration = 60;

export async function POST(request: Request) {
  if (!isCronRequest(request)) return new Response('Unauthorized', { status: 401 });
  const admin = createAdminClient();
  after(async () => {
    try {
      await runQueuedJobs(admin);
    } catch (e) {
      console.error('job worker failed:', e instanceof Error ? e.message : e);
    }
  });
  return Response.json({ accepted: true }, { status: 202 });
}
