import { readFileSync } from 'node:fs';
import path from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { callClaude, type AiCallRow, type AiDeps, type ClaudeRequest } from '@/lib/ai/client';
import { itemsResult } from '@/lib/ai/schemas';
import { assertAiAllowed, AiNotAllowedError, type AiClearance } from '@/lib/ai/switch';
import { findDuplicate } from '@/lib/inbox/plan';
import { processDocument, type Claude, type ProcessInput } from '@/lib/inbox/process';
import type { CourseInfoPayload, CreateItemPayload, UpdateItemPayload } from '@/lib/inbox/types';
import { COURSES, IDS, ITEMS, TERM, TODAY } from './context';

const dir = path.join(__dirname, '../../fixtures/ai');
const text = (name: string) => readFileSync(path.join(dir, name), 'utf8');
const replies = (name: string) =>
  (JSON.parse(text(name)) as { message: Anthropic.Message }[]).map((r) => r.message);

/** A transport that replays recorded messages in order and records what was logged. */
function replay(messages: Anthropic.Message[]) {
  const queue = [...messages];
  const logged: AiCallRow[] = [];
  const deps: AiDeps = {
    send: vi.fn(async () => {
      const next = queue.shift();
      if (!next) throw new Error('No recorded response left');
      return next;
    }),
    log: async (row) => {
      logged.push(row);
    },
  };
  const claude = vi.fn((req: ClaudeRequest<unknown>) => callClaude(deps, req)) as unknown as Claude & ReturnType<typeof vi.fn>;
  return { deps, claude, logged };
}

function input(courseId: string | null, file: string, declaredKind: ProcessInput['declaredKind'] = 'detect'): ProcessInput {
  return {
    userId: IDS.user,
    doc: { id: IDS.doc, course_id: courseId, raw_text: text(file), source_url: null },
    declaredKind,
    courses: COURSES,
    items: ITEMS,
    today: TODAY,
    term: TERM,
  };
}

describe('AI switch', () => {
  const lookup = async (id: string) => COURSES.find((c) => c.id === id) ?? null;

  it('clears STAT 230 and refuses the AI-off courses and content without a course', async () => {
    await expect(assertAiAllowed(lookup, IDS.stat230)).resolves.toMatchObject({ courseCode: 'STAT 230' });
    for (const id of [IDS.cs245, IDS.cs246, IDS.cs251, null]) {
      await expect(assertAiAllowed(lookup, id)).rejects.toBeInstanceOf(AiNotAllowedError);
    }
  });

  it('callClaude refuses to run without a clearance', async () => {
    const { deps } = replay([]);
    await expect(
      callClaude(deps, {
        purpose: 'extract_generic',
        clearance: undefined as unknown as AiClearance,
        userId: IDS.user,
        system: 's',
        user: 'u',
        schema: itemsResult,
      }),
    ).rejects.toThrow(/clearance/);
    expect(deps.send).not.toHaveBeenCalled();
  });
});

describe('paste processing', () => {
  it('turns a STAT 230 outline into item proposals with weights and dates, and course info proposals', async () => {
    const { claude, logged } = replay(replies('stat230-outline.response.json'));
    const res = await processDocument(input(IDS.stat230, 'stat230-outline.txt', 'outline'), claude);

    expect(claude).toHaveBeenCalledTimes(1);
    expect(res.status).toBe('extracted');
    expect(res.kind).toBe('outline');

    const creates = res.proposals.filter((p) => p.kind === 'create_item').map((p) => (p.payload as CreateItemPayload).item);
    expect(creates.map((c) => [c.title, c.weight_percent])).toEqual([
      ['Midterm 1', 20],
      ['Quiz 2 (window Nov 9-13)', 5],
      ['Midterm 2', 20],
      ['Final exam', 50],
    ]);
    const mt1 = creates[0];
    // Oct 22, 2026, 4:30 pm EDT is 20:30 UTC.
    expect(mt1).toMatchObject({ course_id: IDS.stat230, kind: 'midterm', due_at: '2026-10-22T20:30:00.000Z', starts_at: '2026-10-22T20:30:00.000Z', ends_at: '2026-10-22T22:20:00.000Z', time_known: true });
    // Nov 26 is after the DST change: 4:30 pm EST is 21:30 UTC.
    expect(creates[2].due_at).toBe('2026-11-26T21:30:00.000Z');
    expect(creates[1]).toMatchObject({ all_day: true, time_known: false, due_at: '2026-11-09T05:00:00.000Z' });
    expect(creates[3]).toMatchObject({ due_at: null, time_known: false });

    // Quiz 1 already exists: the outline only adds its weight.
    const update = res.proposals.find((p) => p.kind === 'update_item');
    expect(update?.target_item_id).toBe(IDS.statQuiz1);
    expect((update?.payload as UpdateItemPayload).changes).toEqual({ weight_percent: 5 });

    const info = res.proposals.filter((p) => p.kind === 'course_info').map((p) => p.payload as CourseInfoPayload);
    expect(info.find((i) => i.field === 'late_policy')?.value).toBe('No late submissions are accepted.');
    expect(info.find((i) => i.field === 'ai_policy')?.value).toMatch(/not allowed on quizzes/);
    expect(info.find((i) => i.field === 'remark_policy')).toBeTruthy();
    expect(info.find((i) => i.field === 'submission_platforms')?.value).toEqual(['Crowdmark']);
    expect(info.find((i) => i.field === 'info_notes')).toMatchObject({ heading: 'Missed work' });
    expect(info.find((i) => i.field === 'grading_scheme')?.value).toHaveLength(5);
    expect(info.find((i) => i.field === 'staff')?.value).toHaveLength(2);

    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ purpose: 'extract_outline', model: 'claude-sonnet-5', ok: true, request_ref: IDS.doc, input_tokens: 2180 });
    expect(logged[0].cost_usd).toBeCloseTo((2180 * 2 + 1450 * 10) / 1e6, 4);
  });

  it('classifies an announcement, then proposes the moved quiz as an update', async () => {
    const { claude, logged } = replay(replies('stat230-announcement.response.json'));
    const res = await processDocument(input(IDS.stat230, 'stat230-announcement.txt'), claude);
    expect(claude).toHaveBeenCalledTimes(2);
    expect(logged.map((l) => l.purpose)).toEqual(['classify', 'extract_announcement']);
    expect(res).toMatchObject({ status: 'extracted', kind: 'announcement', detectedKind: 'announcement', importance: 'deadline_change' });
    expect(res.summary).toMatch(/Quiz 1 moves/);
    const [update, info] = res.proposals;
    expect(update.kind).toBe('update_item');
    expect((update.payload as UpdateItemPayload).changes).toMatchObject({ due_at: '2026-10-09T04:00:00.000Z', time_known: false });
    expect((update.payload as UpdateItemPayload).before).toMatchObject({ due_at: '2026-10-07T04:00:00.000Z' });
    expect(info.payload).toMatchObject({ field: 'info_notes', heading: 'Office hours' });
  });

  it.each([
    ['CS 245', IDS.cs245],
    ['CS 246', IDS.cs246],
    ['CS 251', IDS.cs251],
  ])('stores a %s paste and never calls Claude', async (_code, courseId) => {
    for (const kind of ['detect', 'outline', 'announcement', 'grade_paste', 'other'] as const) {
      const { claude, deps } = replay(replies('stat230-outline.response.json'));
      const res = await processDocument(input(courseId, 'stat230-outline.txt', kind), claude);
      expect(res.status).toBe('stored_only');
      expect(res.proposals).toEqual([]);
      expect(claude).not.toHaveBeenCalled();
      expect(deps.send).not.toHaveBeenCalled();
    }
  });

  it('stores a paste with no course and never calls Claude', async () => {
    const { claude } = replay(replies('stat230-announcement.response.json'));
    const res = await processDocument(input(null, 'stat230-announcement.txt'), claude);
    expect(res.status).toBe('stored_only');
    expect(claude).not.toHaveBeenCalled();
  });

  it('proposes CS 251 marks from a grades paste, without Claude, matching the midterm', async () => {
    const { claude, deps } = replay([]);
    const raw = readFileSync(path.join(__dirname, '../../fixtures/grades/crowdmark-cs251.txt'), 'utf8');
    const base = input(IDS.cs251, 'odyssey-line.txt', 'grade_paste');
    const res = await processDocument({ ...base, doc: { ...base.doc, raw_text: raw } }, claude);
    expect(res).toMatchObject({ status: 'extracted', kind: 'grade_paste', usedAi: false });
    expect(res.proposals.map((p) => [p.kind, p.course_id, p.target_item_id, p.payload])).toEqual([
      ['grade', IDS.cs251, IDS.csMidterm, { label: 'Midterm', score: 41.5, out_of: 50, item_id: IDS.csMidterm }],
      ['grade', IDS.cs251, null, { label: 'A1', score: 27, out_of: 30, item_id: null }],
      ['grade', IDS.cs251, null, { label: 'Assignment 2', score: 22, out_of: 30, item_id: null }],
    ]);
    expect(claude).not.toHaveBeenCalled();
    expect(deps.send).not.toHaveBeenCalled();
  });

  it('proposes room and seat for the CS 251 midterm from an Odyssey row, without Claude', async () => {
    const { claude } = replay([]);
    for (const declared of ['odyssey_paste', 'detect'] as const) {
      const res = await processDocument(input(IDS.cs251, 'odyssey-line.txt', declared), claude);
      expect(res.kind).toBe('odyssey_paste');
      expect(res.proposals).toHaveLength(1);
      const [p] = res.proposals;
      expect(p).toMatchObject({ kind: 'update_item', target_item_id: IDS.csMidterm, course_id: IDS.cs251 });
      // The time already matches, so only room and seat change.
      expect((p.payload as UpdateItemPayload).changes).toEqual({ location: 'STC 0010', seat: '45' });
    }
    expect(claude).not.toHaveBeenCalled();
  });

  it('proposes meetings from a Quest schedule without Claude, even with no course picked', async () => {
    const { claude } = replay([]);
    const res = await processDocument(input(null, 'quest-tabbed.txt'), claude);
    expect(res.kind).toBe('quest_schedule');
    expect(res.proposals.map((p) => [p.kind, p.course_id])).toEqual([
      ['meeting', IDS.cs251],
      ['meeting', IDS.stat230],
    ]);
    expect(claude).not.toHaveBeenCalled();
  });
});

describe('duplicate check', () => {
  const draft = {
    action: 'create' as const,
    match_item_id: null,
    course_slug: 'stat230',
    kind: 'quiz' as const,
    title: 'Quiz #1',
    date: '2026-10-09',
    time: null,
    end_time: null,
    location: null,
    seat: null,
    weight_percent: null,
    evidence: '',
    confidence: 1,
  };

  it('matches the same course and kind, a similar title, and a date within 3 days', () => {
    expect(findDuplicate(ITEMS, IDS.stat230, draft)?.id).toBe(IDS.statQuiz1);
    expect(findDuplicate(ITEMS, IDS.stat230, { ...draft, date: '2026-10-12' })).toBeUndefined();
    expect(findDuplicate(ITEMS, IDS.stat230, { ...draft, title: 'Quiz 2' })).toBeUndefined();
    expect(findDuplicate(ITEMS, IDS.cs251, draft)).toBeUndefined();
  });
});
