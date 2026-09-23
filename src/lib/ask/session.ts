import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { modelFor } from '@/lib/ai/models';
import { askSystem } from '@/lib/ai/prompts';
import { assertAiAllowed, type CourseLookup } from '@/lib/ai/switch';
import type { Database, Json } from '@/lib/db/types';
import { toTorontoDate } from '@/lib/time';
import { askContextBlock, historyTurns, type HistoryMessage } from './context';
import type { SavedCitation } from './citations';
import { loadChunks, loadCourseContext, policyFor, resolveScope, ScopeError, type PolicyBanner } from './load';
import { askClaude, type AskDeps, type AskEvent } from './run';
import { askScopeSchema } from './scope';

// One Ask turn end to end: thread, history, scope, chunks, the Claude loop, and
// the saved answer. The route streams its events; checks call it with a replay
// transport.

type Db = SupabaseClient<Database>;

export const askInputSchema = z.object({
  threadId: z.uuid().nullish(),
  scope: askScopeSchema,
  question: z.string().trim().min(1, 'Type a question.').max(4000, 'Keep the question under 4,000 characters.'),
  deep: z.boolean().default(false),
});

export type AskInput = z.infer<typeof askInputSchema>;

export type AskStreamEvent =
  | { type: 'meta'; threadId: string; model: string; budgetNotice: boolean; scopeLabel: string; banner: PolicyBanner | null }
  | AskEvent
  | { type: 'done'; messageId: string; content: string; citations: SavedCitation[] }
  | { type: 'error'; message: string };

export const DEFAULT_CONTEXT_BUDGET = 80_000;

function threadTitle(question: string): string {
  const line = question.split('\n')[0].trim();
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

export function courseLookup(db: Db): CourseLookup {
  return async (courseId) => {
    const { data } = await db.from('courses').select('id, code, ai_allowed').eq('id', courseId).maybeSingle();
    return data;
  };
}

export async function runAsk(
  db: Db,
  userId: string,
  input: AskInput,
  deps: AskDeps,
  emit: (e: AskStreamEvent) => void,
  opts: { overBudget: boolean; now?: Date },
): Promise<{ threadId: string; messageId: string } | null> {
  const now = opts.now ?? new Date();
  const resolved = await resolveScope(db, input.scope);
  if (!resolved.courses.length) throw new ScopeError('No course has AI turned on, so Ask has nothing it may use.');
  const lookup = courseLookup(db);
  const clearances = await Promise.all(resolved.courses.map((c) => assertAiAllowed(lookup, c.id)));

  const { data: settings } = await db.from('settings').select('answer_style_prompt, ask_context_budget').eq('user_id', userId).maybeSingle();
  const budget = settings?.ask_context_budget || DEFAULT_CONTEXT_BUDGET;

  // Thread: continue one, or start one titled after the question.
  const courseId = resolved.courses.length === 1 ? resolved.courses[0].id : null;
  let threadId = input.threadId ?? null;
  let history: HistoryMessage[] = [];
  if (threadId) {
    const { data: thread } = await db.from('ask_threads').select('id').eq('id', threadId).maybeSingle();
    if (!thread) throw new ScopeError('That thread no longer exists.');
    const { data: earlier } = await db.from('ask_messages').select('role, content').eq('thread_id', threadId).order('created_at');
    history = (earlier ?? []).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
    await db
      .from('ask_threads')
      .update({ scope: input.scope as Json, course_id: courseId, updated_at: now.toISOString() })
      .eq('id', threadId);
  } else {
    const { data: thread, error } = await db
      .from('ask_threads')
      .insert({ user_id: userId, scope: input.scope as Json, course_id: courseId, title: threadTitle(input.question) })
      .select('id')
      .single();
    if (error) throw new Error(`Could not start the thread: ${error.message}`);
    threadId = thread.id;
  }

  const { error: qErr } = await db.from('ask_messages').insert({ user_id: userId, thread_id: threadId, role: 'user', content: input.question });
  if (qErr) throw new Error(`Could not save the question: ${qErr.message}`);

  // Over budget, Ask falls back to the extraction model (SPEC 4.6).
  const purpose = input.deep ? 'ask_deep' : 'ask';
  const model = opts.overBudget ? modelFor('classify') : modelFor(purpose);
  emit({ type: 'meta', threadId, model, budgetNotice: opts.overBudget, scopeLabel: resolved.label, banner: resolved.banner });

  const [chunks, contextCourses] = await Promise.all([
    loadChunks(db, resolved, input.question, budget),
    loadCourseContext(db, resolved.courses, now),
  ]);
  const scopeItem = resolved.item ? resolved.label : null;

  const answer = await askClaude(
    deps,
    {
      userId,
      clearances,
      purpose,
      model,
      system: askSystem(policyFor(resolved.courses), settings?.answer_style_prompt),
      history: historyTurns(history),
      context: askContextBlock(toTorontoDate(now), contextCourses, scopeItem),
      chunks,
      scopeLabel: resolved.label,
      question: input.question,
      courseSlugs: Object.fromEntries(resolved.courses.map((c) => [c.slug.toLowerCase(), c.id])),
      tool: true,
      maxTokens: input.deep ? 8000 : 4096,
      requestRef: threadId,
    },
    emit,
  );

  const { data: saved, error } = await db
    .from('ask_messages')
    .insert({
      user_id: userId,
      thread_id: threadId,
      role: 'assistant',
      content: answer.text,
      citations: answer.citations as unknown as Json,
      model: answer.model,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Could not save the answer: ${error.message}`);
  await db.from('ask_threads').update({ updated_at: new Date().toISOString() }).eq('id', threadId);
  emit({ type: 'done', messageId: saved.id, content: answer.text, citations: answer.citations });
  return { threadId, messageId: saved.id };
}
