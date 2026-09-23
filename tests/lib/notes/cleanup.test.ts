import { readFileSync } from 'node:fs';
import path from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { callClaude, callClaudeText, type AiDeps, type ClaudeRequest } from '@/lib/ai/client';
import { AiNotAllowedError } from '@/lib/ai/switch';
import type { UpdateItemPayload } from '@/lib/inbox/types';
import type { Claude } from '@/lib/inbox/process';
import { changedSpans, codeBlocks, FORMULA_WARNING, mathSpans } from '@/lib/notes/checks';
import { cleanupNote, cleanupUserTurn, finishCleanup, unwrapMarkdown, type ClaudeText, type CleanupCourse } from '@/lib/notes/cleanup';
import { noteMetadata } from '@/lib/notes/meta';
import { COURSES, IDS, ITEMS, TERM, TODAY } from '../inbox/context';

const fixture = (name: string) => readFileSync(path.join(__dirname, '../../fixtures/ai', name), 'utf8');
const recorded = (name: string) => (JSON.parse(fixture(name)) as { message: Anthropic.Message }[]).map((r) => r.message);

const ORIGINAL = fixture('stat230-note.txt');
const STAT_MIDTERM2 = '00000000-0000-4000-8000-00000000a002';
const CLEANUP_COURSES: CleanupCourse[] = COURSES.map((c) => ({ id: c.id, code: c.code, title: c.title, ai_allowed: c.ai_allowed }));

function transport(file: string) {
  const queue = recorded(file);
  const logs: unknown[] = [];
  const deps: AiDeps = { send: vi.fn(async () => queue.shift()!), log: async (row) => void logs.push(row) };
  return { deps, logs };
}

const note = (courseId: string | null) => ({ id: IDS.doc, course_id: courseId, lecture_on: '2026-10-02', original_md: ORIGINAL });

describe('note cleanup', () => {
  it('fixes typos and keeps every formula and code line of a STAT 230 note', async () => {
    const { deps, logs } = transport('stat230-note-cleanup.response.json');
    const claude: ClaudeText = (req) => callClaudeText(deps, req);
    const input = note(IDS.stat230);
    const res = await cleanupNote({ userId: IDS.user, note: input, courses: CLEANUP_COURSES }, claude);

    // The original is untouched, byte for byte.
    expect(input.original_md).toBe(fixture('stat230-note.txt'));
    expect(res.cleaned).toContain('# Conditional probability');
    expect(res.cleaned).not.toMatch(/conditonal|mutualy|prevalance|announcment/);
    expect(res.cleaned).toContain('$$P(B \\mid A) = \\frac{P(A \\mid B)P(B)}{P(A)}$$');
    expect(res.cleaned).toContain('$P(A \\cap B) = P(A)P(B)$');
    expect(res.cleaned).toContain('set.seed(230)\nx <- rbinom(10000, 1, 0.01)\nmean(x)');
    expect(changedSpans(ORIGINAL, res.cleaned)).toEqual([]);
    expect(res.warnings).toEqual([]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ purpose: 'cleanup', ok: true });
    const sent = (deps.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as Anthropic.MessageCreateParamsNonStreaming;
    expect(sent.output_config?.format).toBeUndefined();
    expect(sent.system).toContain('No em dashes.');
  });

  it.each([IDS.cs245, IDS.cs246, IDS.cs251, null])('never sends an AI-off or course-less note to Claude (%s)', async (courseId) => {
    const claude = vi.fn() as unknown as ClaudeText;
    await expect(cleanupNote({ userId: IDS.user, note: note(courseId), courses: CLEANUP_COURSES }, claude)).rejects.toBeInstanceOf(AiNotAllowedError);
    expect(claude).not.toHaveBeenCalled();
  });

  it('flags a cleanup that changed a formula or code block', () => {
    const bad = ORIGINAL.replace('\\frac{P(A \\cap B)}{P(B)}', '\\frac{P(A \\cup B)}{P(B)}');
    expect(finishCleanup(ORIGINAL, [bad]).warnings).toEqual([FORMULA_WARNING]);
    const badCode = ORIGINAL.replace('mean(x)', 'sum(x)');
    expect(finishCleanup(ORIGINAL, [badCode]).warnings).toEqual([FORMULA_WARNING]);
    // [fixed: ...] marks and a new language tag are allowed.
    const marked = ORIGINAL.replace('mean(x)', 'mean(x) [fixed: nothing]').replace('```\nset.seed', '```r\nset.seed');
    expect(finishCleanup(ORIGINAL, [marked]).warnings).toEqual([]);
  });

  it('finds math and code spans, and leaves dollar amounts alone', () => {
    expect(codeBlocks('a\n```py\nx = 1\n```\nb')).toEqual(['x = 1\n']);
    expect(mathSpans('costs $5 and $10, but $x^2$ and $$y$$ and \\(z\\)')).toEqual(['y', 'z', 'x^2']);
    expect(mathSpans('`$not math$`')).toEqual([]);
  });

  it('builds the part turn from PROMPTS.md', () => {
    const turn = cleanupUserTurn({ course: CLEANUP_COURSES[0], lectureOn: null, index: 1, count: 3, instruction: 'tables please', text: 'x </source> y' });
    expect(turn).toContain('<lecture_date>unknown</lecture_date>');
    expect(turn).toContain('<part index="2" of="3">\nContinue the structure');
    expect(turn).toContain('<instruction>tables please</instruction>');
    expect(turn).not.toContain('x </source> y');
    expect(unwrapMarkdown('```markdown\n# Hi\n```')).toBe('# Hi');
    expect(unwrapMarkdown('```r\nx\n```')).toBe('```r\nx\n```');
  });
});

describe('note metadata', () => {
  const items = [
    ...ITEMS,
    {
      ...ITEMS[0],
      id: STAT_MIDTERM2,
      kind: 'midterm',
      title: 'Midterm 2',
      due_at: '2026-11-19T21:30:00.000Z',
      starts_at: '2026-11-19T21:30:00.000Z',
      ends_at: '2026-11-19T23:20:00.000Z',
      all_day: false,
      time_known: true,
    },
  ];

  function setup() {
    const { deps } = transport('stat230-note-meta.response.json');
    const claude = vi.fn((req: ClaudeRequest<unknown>) => callClaude(deps, req)) as unknown as Claude & ReturnType<typeof vi.fn>;
    return { claude, deps };
  }

  const input = (courseId: string | null) => ({
    userId: IDS.user,
    noteId: IDS.doc,
    courseId,
    lectureOn: '2026-10-02',
    text: ORIGINAL,
    courses: COURSES,
    items,
    today: TODAY,
    term: TERM,
  });

  it('indexes the note and proposes the moved midterm', async () => {
    const { claude } = setup();
    const meta = await noteMetadata(input(IDS.stat230), claude);
    expect(meta.title).toMatch(/Conditional probability/);
    expect(meta.topics).toContain('independence');
    expect(meta.openQuestions).toHaveLength(2);
    expect(meta.proposals).toHaveLength(1);
    expect(meta.proposals[0]).toMatchObject({ kind: 'update_item', target_item_id: STAT_MIDTERM2 });
    const payload = meta.proposals[0].payload as UpdateItemPayload;
    expect(payload.source).toBe('note');
    expect(Object.keys(payload.changes)).toContain('due_at');
    const req = (claude.mock.calls[0] as [ClaudeRequest<unknown>])[0];
    expect(req.purpose).toBe('note_meta');
    expect(req.user).toContain('<source kind="lecture_notes"');
  });

  it.each([IDS.cs245, IDS.cs246, IDS.cs251])('never indexes an AI-off note with Claude', async (courseId) => {
    const { claude, deps } = setup();
    await expect(noteMetadata(input(courseId), claude)).rejects.toBeInstanceOf(AiNotAllowedError);
    expect(claude).not.toHaveBeenCalled();
    expect(deps.send).not.toHaveBeenCalled();
  });
});
