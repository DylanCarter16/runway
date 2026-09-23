import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadScopeOptions, loadThreads } from '@/lib/ask/options';
import type { Database } from '@/lib/db/types';
import { aiConfigured, monthSpendUsd, overBudget } from '@/lib/jobs/ai';

// Shared by /ask, /ask/[threadId], and the course Ask tab.

export async function askPageData(supabase: SupabaseClient<Database>, userId: string, courseId?: string) {
  const [options, threads, spend] = await Promise.all([
    loadScopeOptions(supabase),
    loadThreads(supabase, courseId),
    monthSpendUsd(supabase, userId).catch(() => 0),
  ]);
  return { options, threads, aiReady: aiConfigured(), overBudget: overBudget(spend) };
}
