import { readFileSync } from 'node:fs';
import path from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { callClaude, type AiDeps, type ClaudeRequest } from '@/lib/ai/client';
import { AiNotAllowedError } from '@/lib/ai/switch';
import { MAX_DIFF_CHARS, summarizeDiff, unifiedDiff, type DiffSummaryInput } from '@/lib/inbox/diff-summary';
import type { Claude } from '@/lib/inbox/process';
import type { UpdateItemPayload } from '@/lib/inbox/types';
import { COURSES, IDS, ITEMS, TERM, TODAY } from './context';

const recorded = (JSON.parse(readFileSync(path.join(__dirname, '../../fixtures/ai/stat230-diff.response.json'), 'utf8')) as { message: Anthropic.Message }[]).map(
  (r) => r.message,
);

function setup() {
  const queue = [...recorded];
  const deps: AiDeps = { send: vi.fn(async () => queue.shift()!), log: async () => undefined };
  const claude = vi.fn((req: ClaudeRequest<unknown>) => callClaude(deps, req)) as unknown as Claude & ReturnType<typeof vi.fn>;
  return { deps, claude };
}

const input = (courseId: string): DiffSummaryInput => ({
  userId: IDS.user,
  documentId: IDS.doc,
  courseId,
  label: 'Course schedule',
  url: 'https://example.invalid/schedule',
  diff: { removed: ['Quiz 1: Wednesday, October 7'], added: ['Quiz 1: Friday, October 9'] },
  courses: COURSES,
  items: ITEMS,
  today: TODAY,
  term: TERM,
});

describe('page diff summary', () => {
  it('summarizes an AI-on course page change and proposes the moved date', async () => {
    const { claude } = setup();
    const res = await summarizeDiff(input(IDS.stat230), claude);
    expect(res.summary).toMatch(/Quiz 1 moved/);
    expect(res.proposals).toHaveLength(1);
    expect(res.proposals[0]).toMatchObject({ kind: 'update_item', target_item_id: IDS.statQuiz1 });
    expect((res.proposals[0].payload as UpdateItemPayload).source).toBe('page_diff');
  });

  it.each([IDS.cs245, IDS.cs246, IDS.cs251])('never sends an AI-off course page to Claude', async (courseId) => {
    const { claude, deps } = setup();
    await expect(summarizeDiff(input(courseId), claude)).rejects.toBeInstanceOf(AiNotAllowedError);
    expect(claude).not.toHaveBeenCalled();
    expect(deps.send).not.toHaveBeenCalled();
  });

  it('caps the diff at 20,000 characters', () => {
    const long = unifiedDiff({ added: ['x'.repeat(30_000)], removed: [] });
    expect(long.length).toBeLessThan(MAX_DIFF_CHARS + 60);
    expect(unifiedDiff({ added: ['b'], removed: ['a'] })).toBe('- a\n+ b');
  });
});
