import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { serverEnv } from '@/env';
import { callClaude, type AiDeps, type ClaudeRequest } from '@/lib/ai/client';
import type { Json } from '@/lib/db/types';
import type { Admin } from './queue';

// The live transport for callClaude(): the Anthropic SDK (which retries 429,
// 529, and other 5xx twice, so three tries in all) and ai_calls logging with
// the service role.

let client: Anthropic | null = null;

function anthropic(): Anthropic {
  if (!serverEnv.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set, so Claude is unavailable.');
  client ??= new Anthropic({
    apiKey: serverEnv.ANTHROPIC_API_KEY,
    maxRetries: 2,
    // One job step must finish inside Vercel's 60 second limit.
    timeout: 50_000,
    defaultHeaders: serverEnv.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': serverEnv.ANTHROPIC_WORKSPACE_ID } : undefined,
  });
  return client;
}

export function aiConfigured(): boolean {
  return Boolean(serverEnv.ANTHROPIC_API_KEY);
}

export function liveAiDeps(admin: Admin): AiDeps {
  return {
    send: (params) => anthropic().messages.create(params),
    async log(row) {
      const { error } = await admin.from('ai_calls').insert({ ...row, raw_output: row.raw_output as Json });
      if (error) console.error('could not log ai call:', error.message);
    },
  };
}

export function liveClaude(admin: Admin) {
  const deps = liveAiDeps(admin);
  return <T>(req: ClaudeRequest<T>) => callClaude(deps, req);
}

/** Month-to-date spend in USD from ai_calls (America/Toronto months are close enough to UTC here). */
export async function monthSpendUsd(admin: Admin, userId: string, now = new Date()): Promise<number> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { data, error } = await admin.from('ai_calls').select('cost_usd').eq('user_id', userId).gte('created_at', start);
  if (error) throw new Error(`Could not read AI spend: ${error.message}`);
  return (data ?? []).reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0);
}

export function overBudget(spend: number): boolean {
  return spend >= serverEnv.AI_MONTHLY_BUDGET_USD;
}
