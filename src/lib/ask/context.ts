import type Anthropic from '@anthropic-ai/sdk';
import { splitBlocks } from '@/lib/notes/blocks';

// Context assembly for Ask (Phase 6 tasks 1 and 2). Pure: the loaders in
// load.ts fetch rows, and these functions pick chunks and build the blocks.

export interface AskChunk {
  id: string;
  parentType: 'note' | 'document';
  parentId: string;
  courseId: string | null;
  ord: number;
  heading: string | null;
  content: string;
  tokens: number;
  /** Note or document title with its lecture or captured date. */
  title: string;
  href: string;
}

export interface ContextCourse {
  code: string;
  title: string;
  late_policy: string | null;
  ai_policy: string | null;
  remark_policy: string | null;
  next: { kind: string; title: string; date: string | null; time: string | null }[];
}

/** "everything" search depth (PHASES.md, Phase 6 task 1). */
export const ALL_SCOPE_TOP = 40;
/** Course scope when the notes don't fit: this many recent chunks after the search hits. */
export const COURSE_RECENT = 10;
/** Search hits fetched for a course scope that doesn't fit the budget. */
export const COURSE_SEARCH_TOP = 30;
/** How many earlier messages of a thread go back to Claude. */
export const HISTORY_MESSAGES = 12;

/** Keeps chunks in order until the token budget runs out. Never drops a duplicate's first copy. */
export function withinBudget(chunks: AskChunk[], budget: number): AskChunk[] {
  const out: AskChunk[] = [];
  const seen = new Set<string>();
  let used = 0;
  for (const c of chunks) {
    if (seen.has(c.id)) continue;
    if (used + c.tokens > budget) continue;
    seen.add(c.id);
    used += c.tokens;
    out.push(c);
  }
  return out;
}

/** Course scope: every chunk when they fit, otherwise search hits then the most recent ones. */
export function selectCourseChunks(all: AskChunk[], hits: AskChunk[], recent: AskChunk[], budget: number): AskChunk[] {
  const total = all.reduce((sum, c) => sum + c.tokens, 0);
  if (total <= budget) return all;
  return withinBudget([...hits, ...recent.slice(0, COURSE_RECENT)], budget);
}

function attr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function text(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

/** The course context block: code, title, policies, next 5 items (PROMPTS.md 10). */
export function askContextBlock(today: string, courses: ContextCourse[], scopeItem?: string | null): string {
  const lines = ['<context>', `<today>${today}</today>`, '<timezone>America/Toronto</timezone>'];
  for (const c of courses) {
    lines.push(`<course code="${attr(c.code)}" title="${attr(c.title)}">`);
    if (c.late_policy) lines.push(`<late_policy>${text(c.late_policy)}</late_policy>`);
    if (c.ai_policy) lines.push(`<ai_policy>${text(c.ai_policy)}</ai_policy>`);
    if (c.remark_policy) lines.push(`<remark_policy>${text(c.remark_policy)}</remark_policy>`);
    lines.push('<next_items>');
    for (const i of c.next.slice(0, 5)) {
      lines.push(`  <item kind="${attr(i.kind)}" title="${attr(i.title)}" date="${i.date ?? ''}" time="${i.time ?? ''}"/>`);
    }
    lines.push('</next_items>', '</course>');
  }
  if (scopeItem) lines.push(`<scope_item>${text(scopeItem)}</scope_item>`);
  lines.push('</context>');
  return lines.join('\n');
}

/**
 * One search_result block per chunk. The chunk splits into paragraph text
 * blocks so a citation points at the passage, not the whole chunk.
 */
export function searchResultBlock(chunk: AskChunk): Anthropic.SearchResultBlockParam {
  const paragraphs = splitBlocks(chunk.content)
    .map((b) => b.text.trim())
    .filter(Boolean);
  // A chunk that continues a section doesn't start with its heading; add it for context.
  const heading = chunk.heading?.trim() && !/^#{1,6}\s/.test(paragraphs[0] ?? '') ? chunk.heading.trim() : null;
  const content = [heading, ...paragraphs].filter((t): t is string => Boolean(t)).map((t) => ({ type: 'text' as const, text: t }));
  return {
    type: 'search_result',
    source: `chunk:${chunk.id}`,
    title: chunk.title,
    content: content.length ? content : [{ type: 'text', text: chunk.content || '(empty)' }],
    citations: { enabled: true },
  };
}

export function searchResultBlocks(chunks: AskChunk[], cacheLast: boolean): Anthropic.SearchResultBlockParam[] {
  const blocks = chunks.map(searchResultBlock);
  if (cacheLast && blocks.length) blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: { type: 'ephemeral' } };
  return blocks;
}

/** Stored answers carry citation markers; earlier turns go back to Claude without them. */
export function stripMarkers(content: string): string {
  return content.replace(/ ?\[\d+\]\(#source-\d+\)/g, '');
}

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** The last few turns of a thread, starting with a user turn so roles alternate. */
export function historyTurns(messages: HistoryMessage[]): Anthropic.MessageParam[] {
  const recent = messages.slice(-HISTORY_MESSAGES);
  while (recent.length && recent[0].role !== 'user') recent.shift();
  const out: Anthropic.MessageParam[] = [];
  for (const m of recent) {
    const content = m.role === 'assistant' ? stripMarkers(m.content) : m.content;
    if (!content.trim()) continue;
    const last = out[out.length - 1];
    // Two turns in a row from one role (an answer that failed) merge into one.
    if (last && last.role === m.role) last.content = `${last.content as string}\n\n${content}`;
    else out.push({ role: m.role, content });
  }
  if (out.length && out[out.length - 1].role === 'user') out.pop();
  return out;
}
