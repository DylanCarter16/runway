import { readFileSync } from 'node:fs';
import path from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { askSystem, GENERAL_KNOWLEDGE_HEADING } from '@/lib/ai/prompts';
import { AiNotAllowedError, assertAiAllowed, type AiClearance } from '@/lib/ai/switch';
import {
  askContextBlock,
  historyTurns,
  searchResultBlock,
  selectCourseChunks,
  stripMarkers,
  withinBudget,
  type AskChunk,
} from '@/lib/ask/context';
import { askClaude, MAX_TOOL_ROUNDS, type AskEvent, type AskRequest } from '@/lib/ask/run';
import { parseScopeKey, readScope, scopeKey } from '@/lib/ask/scope';
import { chunkNote } from '@/lib/notes/chunk';
import { COURSES, IDS } from '../inbox/context';
import { replayAsk } from './replay';

const fixtures = path.join(__dirname, '../../fixtures/ai');
const recorded = (name: string) =>
  (JSON.parse(readFileSync(path.join(fixtures, name), 'utf8')) as { message: Anthropic.Message }[]).map((r) => r.message);

const NOTE_ID = '00000000-0000-4000-8000-00000000c001';
const lookup = async (id: string) => COURSES.find((c) => c.id === id) ?? null;

function noteChunks(courseId = IDS.stat230): AskChunk[] {
  const md = readFileSync(path.join(fixtures, 'stat230-note-independence.md'), 'utf8');
  return chunkNote(md, { min: 20, max: 120 }).map((c) => ({
    id: `00000000-0000-4000-8000-0000000cc00${c.ord}`,
    parentType: 'note',
    parentId: NOTE_ID,
    courseId,
    ord: c.ord,
    heading: c.heading,
    content: c.content,
    tokens: c.token_estimate,
    title: 'Independence (2026-10-02)',
    href: `/notes/${NOTE_ID}`,
  }));
}

async function request(overrides: Partial<AskRequest> = {}): Promise<AskRequest> {
  const clearance = await assertAiAllowed(lookup, IDS.stat230);
  return {
    userId: IDS.user,
    clearances: [clearance],
    purpose: 'ask',
    model: 'claude-sonnet-5',
    system: askSystem('AI is allowed as a study aid.', null),
    history: [],
    context: askContextBlock('2026-10-05', [
      { code: 'STAT 230', title: 'Probability', late_policy: null, ai_policy: 'AI is allowed as a study aid.', remark_policy: null, next: [] },
    ]),
    chunks: noteChunks(),
    scopeLabel: 'STAT 230',
    question: "What's the difference between independent and mutually exclusive events?",
    courseSlugs: { stat230: IDS.stat230 },
    tool: true,
    ...overrides,
  };
}

describe('Ask scope', () => {
  it('round-trips scope keys and falls back to everything', () => {
    const course = { type: 'course' as const, courseId: IDS.stat230 };
    expect(parseScopeKey(scopeKey(course))).toEqual(course);
    expect(parseScopeKey('note:not-a-uuid')).toEqual({ type: 'all' });
    expect(readScope({ type: 'weird' })).toEqual({ type: 'all' });
    expect(readScope({ type: 'all' })).toEqual({ type: 'all' });
  });
});

describe('Ask context', () => {
  const chunk = (id: string, tokens: number): AskChunk => ({ ...noteChunks()[0], id, tokens });

  it('keeps chunks in order within the budget and skips duplicates', () => {
    const picked = withinBudget([chunk('a', 50), chunk('b', 60), chunk('a', 50), chunk('c', 40)], 100);
    expect(picked.map((c) => c.id)).toEqual(['a', 'c']);
  });

  it('sends every course chunk when they fit, else search hits then recent ones', () => {
    const all = [chunk('a', 30), chunk('b', 30), chunk('c', 30)];
    expect(selectCourseChunks(all, [], [], 100).map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(selectCourseChunks(all, [chunk('c', 30)], [chunk('a', 30), chunk('c', 30), chunk('b', 30)], 70).map((c) => c.id)).toEqual(['c', 'a']);
  });

  it('turns a chunk into a citable search_result with one block per paragraph', () => {
    const [first] = noteChunks();
    const block = searchResultBlock(first);
    expect(block.source).toBe(`chunk:${first.id}`);
    expect(block.title).toBe('Independence (2026-10-02)');
    expect(block.citations).toEqual({ enabled: true });
    expect(block.content.length).toBeGreaterThan(1);
    expect(block.content[0].text).toBe('# Independence');
  });

  it('adds the heading to a chunk that continues a section', () => {
    const block = searchResultBlock({ ...noteChunks()[0], heading: 'Complements', content: 'If A and B are independent...' });
    expect(block.content.map((t) => t.text)).toEqual(['Complements', 'If A and B are independent...']);
  });

  it('builds the course context block with policies and next items', () => {
    const block = askContextBlock(
      '2026-10-05',
      [
        {
          code: 'STAT 230',
          title: 'Probability',
          late_policy: 'No late work',
          ai_policy: 'Study aid <ok>',
          remark_policy: null,
          next: [{ kind: 'quiz', title: 'Quiz 2', date: '2026-10-16', time: null }],
        },
      ],
      'Quiz 2 (quiz, 2026-10-16)',
    );
    expect(block).toContain('<course code="STAT 230" title="Probability">');
    expect(block).toContain('<ai_policy>Study aid &lt;ok></ai_policy>');
    expect(block).toContain('<item kind="quiz" title="Quiz 2" date="2026-10-16" time=""/>');
    expect(block).toContain('<scope_item>Quiz 2 (quiz, 2026-10-16)</scope_item>');
  });

  it('sends earlier turns without citation markers, alternating roles', () => {
    expect(stripMarkers('Yes [1](#source-1) [2](#source-2).')).toBe('Yes.');
    const turns = historyTurns([
      { role: 'assistant', content: 'orphan' },
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1 [1](#source-1)' },
      { role: 'user', content: 'q2 (never answered)' },
      { role: 'user', content: 'q3' },
    ]);
    expect(turns).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
    ]);
  });
});

describe('askClaude', () => {
  it('answers from the note with citations that open it', async () => {
    const replay = replayAsk(recorded('stat230-ask-independence.response.json'));
    const events: AskEvent[] = [];
    const answer = await askClaude(replay.deps, await request(), (e) => events.push(e));

    expect(answer.citations.length).toBeGreaterThanOrEqual(1);
    for (const c of answer.citations) {
      expect(c.parent_type).toBe('note');
      expect(c.parent_id).toBe(NOTE_ID);
      expect(c.href).toBe(`/notes/${NOTE_ID}`);
      expect(answer.text).toContain(`[${c.n}](#source-${c.n})`);
    }
    expect(answer.citations.map((c) => c.n)).toEqual(answer.citations.map((_, i) => i + 1));
    expect(answer.citations.some((c) => c.cited_text.includes('Mutually exclusive means'))).toBe(true);
    // The streamed pieces add up to the saved answer.
    const streamed = events.filter((e) => e.type === 'text').map((e) => e.text).join('');
    expect(streamed.trim()).toBe(answer.text);
    expect(events.filter((e) => e.type === 'source')).toHaveLength(answer.citations.length);
    expect(answer.costUsd).toBeGreaterThan(0);
    expect(replay.logs).toHaveLength(1);
    expect(replay.logs[0]).toMatchObject({ purpose: 'ask', model: 'claude-sonnet-5', ok: true, user_id: IDS.user });
  });

  it('puts the corpus first, caches it, and ends with the scope and question', async () => {
    const replay = replayAsk(recorded('stat230-ask-independence.response.json'));
    await askClaude(replay.deps, await request(), () => undefined);
    const [sent] = replay.requests;
    expect(sent.output_config).toBeUndefined();
    expect(sent.system).toContain('Course AI policy for this scope: AI is allowed as a study aid.');
    const content = sent.messages.at(-1)!.content as Anthropic.ContentBlockParam[];
    expect(content[0]).toMatchObject({ type: 'text' });
    expect((content[0] as Anthropic.TextBlockParam).text).toContain('<context>');
    const results = content.filter((b) => b.type === 'search_result');
    expect(results.length).toBe(noteChunks().length);
    expect(results.at(-1)).toMatchObject({ cache_control: { type: 'ephemeral' } });
    expect(results.slice(0, -1).every((b) => !('cache_control' in b))).toBe(true);
    const last = content.at(-1) as Anthropic.TextBlockParam;
    expect(last.text).toBe(
      "<scope>STAT 230</scope>\n<question>What's the difference between independent and mutually exclusive events?</question>",
    );
    expect(sent.tools?.[0]).toMatchObject({ name: 'search_library' });
  });

  it('searches the library when the notes fall short, then says so and adds general knowledge', async () => {
    const search = vi.fn(async () => []);
    const replay = replayAsk(recorded('stat230-ask-uncovered.response.json'), search);
    const events: AskEvent[] = [];
    const answer = await askClaude(replay.deps, await request({ question: 'What is a moment generating function?' }), (e) => events.push(e));

    expect(search).toHaveBeenCalledWith('moment generating function', [IDS.stat230]);
    expect(events).toContainEqual({ type: 'status', text: 'Searching your notes for "moment generating function"' });
    expect(replay.requests).toHaveLength(2);
    const toolTurn = replay.requests[1].messages.at(-1)!;
    expect(toolTurn.content).toEqual([
      { type: 'tool_result', tool_use_id: 'toolu_fixture_mgf', content: [{ type: 'text', text: 'No results found.' }] },
    ]);
    expect(answer.text).toMatch(/^I'll check your notes for this first\.\n\nYour notes don't cover/);
    expect(answer.text).toContain(`## ${GENERAL_KNOWLEDGE_HEADING}`);
    expect(answer.citations).toEqual([]);
    expect(answer.toolRounds).toBe(1);
    expect(replay.logs).toHaveLength(2);
  });

  it('never sends a passage from a course with AI off', async () => {
    const replay = replayAsk(recorded('stat230-ask-independence.response.json'));
    const cs251 = noteChunks(IDS.cs251);
    await expect(askClaude(replay.deps, await request({ chunks: [...noteChunks(), ...cs251] }), () => undefined)).rejects.toThrow(
      AiNotAllowedError,
    );
    const orphan = noteChunks().map((c) => ({ ...c, courseId: null }));
    await expect(askClaude(replay.deps, await request({ chunks: orphan }), () => undefined)).rejects.toThrow(AiNotAllowedError);
    await expect(askClaude(replay.deps, await request({ clearances: [] as AiClearance[] }), () => undefined)).rejects.toThrow();
    expect(replay.requests).toHaveLength(0);
    await expect(assertAiAllowed(lookup, IDS.cs251)).rejects.toThrow(AiNotAllowedError);
  });

  it('drops tool results from courses with AI off', async () => {
    const leaked = noteChunks(IDS.cs251).map((c) => ({ ...c, id: c.id.replace('cc', 'dd') }));
    const replay = replayAsk(recorded('stat230-ask-uncovered.response.json'), async () => leaked);
    await askClaude(replay.deps, await request({ chunks: [] }), () => undefined);
    const toolTurn = replay.requests[1].messages.at(-1)!;
    expect(JSON.stringify(toolTurn.content)).not.toContain('chunk:');
    expect(JSON.stringify(toolTurn.content)).toContain('No results found.');
  });

  it(`stops offering the tool after ${MAX_TOOL_ROUNDS} searches`, async () => {
    const [toolRound, final] = recorded('stat230-ask-uncovered.response.json');
    const replay = replayAsk([toolRound, toolRound, toolRound, final]);
    const answer = await askClaude(replay.deps, await request(), () => undefined);
    expect(replay.requests).toHaveLength(4);
    expect(replay.requests.slice(0, 3).every((r) => r.tool_choice?.type === 'auto')).toBe(true);
    expect(replay.requests[3].tool_choice).toEqual({ type: 'none' });
    expect(answer.toolRounds).toBe(MAX_TOOL_ROUNDS);
  });

  it('keeps earlier messages of the thread in context', async () => {
    const replay = replayAsk(recorded('stat230-ask-independence.response.json'));
    const history = historyTurns([
      { role: 'user', content: 'What is independence?' },
      { role: 'assistant', content: 'Knowing one event happened does not change the other [1](#source-1).' },
    ]);
    await askClaude(replay.deps, await request({ history, question: 'And mutually exclusive?' }), () => undefined);
    const sent = replay.requests[0].messages;
    expect(sent).toHaveLength(3);
    expect(sent[0]).toEqual({ role: 'user', content: 'What is independence?' });
    expect(sent[1]).toEqual({ role: 'assistant', content: 'Knowing one event happened does not change the other.' });
    expect(JSON.stringify(sent[2].content)).toContain('<question>And mutually exclusive?</question>');
  });

  it('logs a refusal and throws', async () => {
    const [message] = recorded('stat230-ask-independence.response.json');
    const replay = replayAsk([{ ...message, stop_reason: 'refusal' }]);
    await expect(askClaude(replay.deps, await request(), () => undefined)).rejects.toThrow('Claude declined this question.');
    expect(replay.logs[0]).toMatchObject({ ok: false, error: 'Claude declined this question.' });
  });
});
