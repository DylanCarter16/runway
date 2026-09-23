import { AiNotAllowedError } from '@/lib/ai/switch';
import { liveAskDeps } from '@/lib/ask/live';
import { ScopeError } from '@/lib/ask/load';
import { askInputSchema, runAsk, type AskStreamEvent } from '@/lib/ask/session';
import { createClient, requireUser } from '@/lib/db/server';
import { aiConfigured, monthSpendUsd, overBudget } from '@/lib/jobs/ai';

// Ask (docs/SPEC.md 4.6). Streams newline-delimited JSON events: meta, text,
// source, status, then done or error. Answers are saved to the thread as they finish.

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const supabase = await createClient();

  const body = await request.json().catch(() => null);
  const parsed = askInputSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Bad request.' }, { status: 400 });
  if (!aiConfigured()) return Response.json({ error: 'Claude isn’t set up yet, so Ask can’t answer. See docs/BLOCKED.md.' }, { status: 503 });

  const spend = await monthSpendUsd(supabase, user.id).catch(() => 0);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: AskStreamEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      try {
        await runAsk(supabase, user.id, parsed.data, liveAskDeps(supabase), send, { overBudget: overBudget(spend) });
      } catch (e) {
        const known = e instanceof ScopeError || e instanceof AiNotAllowedError;
        if (!known) console.error('ask failed:', e instanceof Error ? e.message : e);
        send({ type: 'error', message: known && e instanceof Error ? e.message : 'Ask couldn’t finish this answer. Try again in a minute.' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
  });
}
