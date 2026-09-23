import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json, Tables } from '@/lib/db/types';

// The jobs table as a queue. Slow work (syncs, later LLM calls and calendar writes)
// is enqueued, the request answers, and the worker processes it with after().
// Every step stays well under Vercel Hobby's 60 second limit.

export type Admin = SupabaseClient<Database>;
export type Job = Tables<'jobs'>;

export type JobHandler = (admin: Admin, job: Job) => Promise<void>;

export interface EnqueueInput {
  userId: string;
  type: string;
  payload?: Record<string, unknown>;
  /** At most one pending or running job per key (partial unique index jobs_dedupe). */
  dedupeKey?: string;
  runAfter?: Date;
  maxAttempts?: number;
}

/** Returns false when a job with the same dedupe key is already queued. */
export async function enqueue(admin: Admin, input: EnqueueInput): Promise<boolean> {
  const { error } = await admin.from('jobs').insert({
    user_id: input.userId,
    type: input.type,
    payload: (input.payload ?? {}) as Json,
    dedupe_key: input.dedupeKey ?? null,
    run_after: (input.runAfter ?? new Date()).toISOString(),
    max_attempts: input.maxAttempts ?? 3,
  });
  if (!error) return true;
  if (error.code === '23505') return false;
  throw new Error(`Could not queue ${input.type}: ${error.message}`);
}

/** 1 minute, then 4, then 16. */
export function backoffMs(attempts: number): number {
  return 60_000 * 4 ** Math.max(0, attempts - 1);
}

export interface ProcessResult {
  done: number;
  failed: number;
  retried: number;
}

/**
 * Claims and runs ready jobs until the queue is empty or the time budget is spent.
 * Unfinished jobs stay pending for the next worker call (Supabase Cron hits
 * /api/jobs/run every minute).
 */
export async function processJobs(
  admin: Admin,
  handlers: Record<string, JobHandler>,
  opts: { budgetMs?: number; batch?: number } = {},
): Promise<ProcessResult> {
  const started = Date.now();
  const budget = opts.budgetMs ?? 45_000;
  const result: ProcessResult = { done: 0, failed: 0, retried: 0 };
  await admin.rpc('requeue_stale_jobs', {});

  while (Date.now() - started < budget) {
    const { data: jobs, error } = await admin.rpc('claim_jobs', { p_limit: opts.batch ?? 3 });
    if (error) throw new Error(`Could not claim jobs: ${error.message}`);
    if (!jobs?.length) break;

    for (const job of jobs) {
      const handler = handlers[job.type];
      try {
        if (!handler) throw new Error(`No handler for job type ${job.type}`);
        await handler(admin, job);
        await admin.from('jobs').update({ status: 'done', locked_at: null, last_error: null }).eq('id', job.id);
        result.done++;
      } catch (e) {
        const message = (e instanceof Error ? e.message : String(e)).slice(0, 2000);
        const final = job.attempts >= job.max_attempts;
        await admin
          .from('jobs')
          .update({
            status: final ? 'failed' : 'pending',
            locked_at: null,
            last_error: message,
            run_after: new Date(Date.now() + backoffMs(job.attempts)).toISOString(),
          })
          .eq('id', job.id);
        if (final) result.failed++;
        else result.retried++;
      }
    }
  }
  return result;
}
