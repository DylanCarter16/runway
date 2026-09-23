import type Anthropic from '@anthropic-ai/sdk';
import { ClaudeError, emptyRow, type AiCallRow } from '@/lib/ai/client';
import { costUsd } from '@/lib/ai/pricing';
import { SEARCH_LIBRARY_TOOL } from '@/lib/ai/prompts';
import { AiNotAllowedError, type AiClearance } from '@/lib/ai/switch';
import { CitationTracker, markers, type SavedCitation } from './citations';
import { searchResultBlocks, type AskChunk } from './context';

// The Ask loop (Phase 6 tasks 1 to 4): stream an answer with citations, run the
// search_library tool for up to 3 rounds, and log every request to ai_calls.
// Transport, search, and logging are injected so tests replay recorded answers.

export type StreamEvent =
  | { type: 'text'; text: string }
  /** A text block finished; its citations arrive with it. */
  | { type: 'block_end'; citations: Anthropic.TextCitation[] | null };

export interface AskDeps {
  stream(params: Anthropic.MessageCreateParamsNonStreaming, on: (e: StreamEvent) => void): Promise<Anthropic.Message>;
  log(row: AiCallRow): Promise<void>;
  /** search_chunks over the given courses, best first. */
  search(query: string, courseIds: string[]): Promise<AskChunk[]>;
}

export type AskEvent = { type: 'text'; text: string } | { type: 'source'; citation: SavedCitation } | { type: 'status'; text: string };

export interface AskRequest {
  userId: string;
  /** One clearance per course whose content may be sent. */
  clearances: AiClearance[];
  purpose: 'ask' | 'ask_deep';
  model: string;
  system: string;
  history: Anthropic.MessageParam[];
  /** The course context block. */
  context: string;
  chunks: AskChunk[];
  scopeLabel: string;
  question: string;
  /** Course slugs Claude may name in search_library, mapped to course ids. Only cleared courses. */
  courseSlugs: Record<string, string>;
  tool: boolean;
  maxTokens?: number;
  requestRef?: string | null;
}

export interface AskAnswer {
  text: string;
  citations: SavedCitation[];
  model: string;
  costUsd: number;
  toolRounds: number;
}

export const MAX_TOOL_ROUNDS = 3;
const TOOL_RESULTS = 10;

/**
 * Every chunk sent to Claude must belong to a course with a clearance. Content
 * with no course never goes, like everywhere else (CLAUDE.md, AI rules).
 */
export function assertCleared(chunks: AskChunk[], clearances: AiClearance[]): void {
  const ok = new Set(clearances.map((c) => c.courseId));
  for (const c of chunks) {
    if (!c.courseId || !ok.has(c.courseId)) {
      throw new AiNotAllowedError('A passage from a course with AI off almost reached Claude, so the question was stopped.');
    }
  }
}

function toParam(block: Anthropic.ContentBlock): Anthropic.ContentBlockParam | null {
  switch (block.type) {
    case 'text':
      return block.text ? { type: 'text', text: block.text } : null;
    case 'tool_use':
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
    case 'thinking':
      return { type: 'thinking', thinking: block.thinking, signature: block.signature };
    case 'redacted_thinking':
      return { type: 'redacted_thinking', data: block.data };
    default:
      return null;
  }
}

function readToolInput(input: unknown): { query: string; courseSlug: string | null } {
  const o = (input ?? {}) as { query?: unknown; course_slug?: unknown };
  return {
    query: typeof o.query === 'string' ? o.query.slice(0, 300) : '',
    courseSlug: typeof o.course_slug === 'string' ? o.course_slug : null,
  };
}

export async function askClaude(deps: AskDeps, req: AskRequest, emit: (e: AskEvent) => void): Promise<AskAnswer> {
  if (!req.clearances.length) throw new ClaudeError('Ask needs a clearance from assertAiAllowed().');
  assertCleared(req.chunks, req.clearances);
  const cleared = new Set(req.clearances.map((c) => c.courseId));

  const tracker = new CitationTracker(req.chunks);
  const first: Anthropic.ContentBlockParam[] = [
    { type: 'text', text: req.context, ...(req.chunks.length ? {} : { cache_control: { type: 'ephemeral' as const } }) },
    ...searchResultBlocks(req.chunks, true),
    { type: 'text', text: `<scope>${req.scopeLabel}</scope>\n<question>${req.question}</question>` },
  ];
  const messages: Anthropic.MessageParam[] = [...req.history, { role: 'user', content: first }];

  let answer = '';
  let cost = 0;
  let toolRounds = 0;
  const say = (text: string) => {
    if (!text) return;
    answer += text;
    emit({ type: 'text', text });
  };

  for (;;) {
    if (answer && !answer.endsWith('\n')) say('\n\n');
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: req.model,
      max_tokens: req.maxTokens ?? 4096,
      system: req.system,
      messages,
      ...(req.tool
        ? { tools: [SEARCH_LIBRARY_TOOL], tool_choice: toolRounds >= MAX_TOOL_ROUNDS ? { type: 'none' as const } : { type: 'auto' as const } }
        : {}),
    };

    const row: AiCallRow = emptyRow({ purpose: req.purpose, userId: req.userId, requestRef: req.requestRef }, req.model);
    const started = Date.now();
    let message: Anthropic.Message;
    let roundText = '';
    try {
      message = await deps.stream(params, (e) => {
        if (e.type === 'text') {
          roundText += e.text;
          say(e.text);
          return;
        }
        const { numbers, added } = tracker.cite(e.citations);
        say(markers(numbers));
        for (const citation of added) emit({ type: 'source', citation });
      });
      const usage = message.usage;
      row.input_tokens = usage.input_tokens;
      row.output_tokens = usage.output_tokens;
      row.cache_read_tokens = usage.cache_read_input_tokens ?? null;
      row.cache_write_tokens = usage.cache_creation_input_tokens ?? null;
      row.cost_usd = costUsd(req.model, usage);
      cost += row.cost_usd;
      row.raw_output = { stop_reason: message.stop_reason, text: roundText, tool_round: toolRounds };
      if (message.stop_reason === 'refusal') throw new ClaudeError('Claude declined this question.');
      row.ok = true;
    } catch (e) {
      row.error = (e instanceof Error ? e.message : String(e)).slice(0, 1000);
      throw e;
    } finally {
      row.duration_ms = Date.now() - started;
      await deps.log(row).catch(() => undefined);
    }

    if (message.stop_reason === 'max_tokens') {
      say('\n\n*The answer was cut off at the length limit.*');
      break;
    }
    const uses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (message.stop_reason !== 'tool_use' || !uses.length || !req.tool || toolRounds >= MAX_TOOL_ROUNDS) break;

    toolRounds += 1;
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of uses) {
      const input = readToolInput(use.input);
      const slugCourse = input.courseSlug ? req.courseSlugs[input.courseSlug.toLowerCase()] : undefined;
      const courseIds = slugCourse ? [slugCourse] : [...cleared];
      emit({ type: 'status', text: `Searching your notes for "${input.query}"` });
      const found = input.query ? await deps.search(input.query, courseIds) : [];
      const allowed = found.filter((c) => c.courseId && cleared.has(c.courseId)).slice(0, TOOL_RESULTS);
      assertCleared(allowed, req.clearances);
      tracker.add(allowed);
      results.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: allowed.length ? searchResultBlocks(allowed, false) : [{ type: 'text', text: 'No results found.' }],
      });
    }
    const assistant = message.content.map(toParam).filter((b): b is Anthropic.ContentBlockParam => b !== null);
    messages.push({ role: 'assistant', content: assistant }, { role: 'user', content: results });
  }

  const text = answer.trim();
  if (!text) throw new ClaudeError('Claude returned an empty answer.');
  return { text, citations: tracker.saved, model: req.model, costUsd: Math.round(cost * 10_000) / 10_000, toolRounds };
}
