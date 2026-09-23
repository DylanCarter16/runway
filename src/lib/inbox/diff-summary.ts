import { DIFF_SYSTEM } from '@/lib/ai/prompts';
import { contextBlock, sourceBlock, type PromptContext } from '@/lib/ai/prompts/shared';
import { diffSummaryResult } from '@/lib/ai/schemas';
import { assertAiAllowed } from '@/lib/ai/switch';
import { contextItems, draftsToProposals } from './plan';
import type { Claude } from './process';
import type { CourseCtx, ItemCtx, PlannedProposal } from './types';

// Page diff summary (docs/PROMPTS.md section 7, Phase 3 task 8). Runs only for
// pages whose course has AI on; every other page keeps its raw diff.

export const MAX_DIFF_CHARS = 20_000;

export function unifiedDiff(diff: { added: string[]; removed: string[] }): string {
  const text = [...diff.removed.map((l) => `- ${l}`), ...diff.added.map((l) => `+ ${l}`)].join('\n');
  return text.length > MAX_DIFF_CHARS ? `${text.slice(0, MAX_DIFF_CHARS)}\n[diff cut at ${MAX_DIFF_CHARS} characters]` : text;
}

export interface DiffSummaryInput {
  userId: string;
  documentId: string;
  courseId: string | null;
  label: string;
  url: string;
  diff: { added: string[]; removed: string[] };
  courses: CourseCtx[];
  items: ItemCtx[];
  today: string;
  term: PromptContext['term'];
}

export interface DiffSummary {
  summary: string;
  importance: string;
  proposals: PlannedProposal[];
}

/** Throws AiNotAllowedError for AI-off courses before any prompt is built. */
export async function summarizeDiff(input: DiffSummaryInput, claude: Claude): Promise<DiffSummary> {
  const clearance = await assertAiAllowed(async (id) => input.courses.find((c) => c.id === id) ?? null, input.courseId);
  const course = input.courses.find((c) => c.id === clearance.courseId)!;
  const ctx: PromptContext = {
    today: input.today,
    term: input.term,
    courses: input.courses.map((c) => ({ slug: c.slug, code: c.code, title: c.title })),
    items: contextItems(input.items, input.courses, course.id),
  };
  const { data } = await claude({
    purpose: 'summarize_diff',
    clearance,
    userId: input.userId,
    requestRef: input.documentId,
    system: DIFF_SYSTEM,
    user: `${contextBlock(ctx)}\n${sourceBlock('page_diff', course.slug, unifiedDiff(input.diff), { label: input.label, url: input.url })}`,
    schema: diffSummaryResult,
  });
  const proposals = draftsToProposals(data.items, {
    courses: input.courses,
    items: input.items,
    defaultCourseId: course.id,
    source: 'page_diff',
    sourceUrl: input.url,
  });
  return { summary: data.summary, importance: data.importance, proposals: data.importance === 'noise' ? [] : proposals };
}
