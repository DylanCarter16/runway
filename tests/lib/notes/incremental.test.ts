import { describe, expect, it } from 'vitest';
import { INSERTED_MARK, REVISED_MARK, describePlan, planIncremental, splitBlocks } from '@/lib/notes/incremental';

// A running STAT 230 document after two lectures.
const L1 = [
  '# STAT 230',
  '## Lecture 1: sample spaces',
  'A sample space S is the set of all outcomes of an experiment.',
  'An event is a subset of S. Events A and B are mutually exclusive when A ∩ B = ∅.',
].join('\n\n');
const L2 = [
  '## Lecture 2: counting',
  'The number of arrangements of n distinct objects is n!.',
  'Choosing k of n without order: $\\binom{n}{k} = \\frac{n!}{k!(n-k)!}$.',
].join('\n\n');
const DOC = `${L1}\n\n${L2}`;

describe('splitBlocks', () => {
  it('splits at blank lines and keeps fenced code and display math whole', () => {
    const text = 'Intro line\nsecond line\n\n```r\nx <- 1\n\ny <- 2\n```\n\n$$\na = b\n\nc = d\n$$\n\nEnd';
    expect(splitBlocks(text)).toEqual(['Intro line\nsecond line', '```r\nx <- 1\n\ny <- 2\n```', '$$\na = b\n\nc = d\n$$', 'End']);
  });

  it('treats CRLF and runs of blank lines like single breaks', () => {
    expect(splitBlocks('a\r\n\r\n\r\nb')).toEqual(['a', 'b']);
  });
});

describe('planIncremental', () => {
  it('first paste for a course: everything is new, nothing reported as skipped', () => {
    const plan = planIncremental(null, L1);
    expect(plan.hadPrevious).toBe(false);
    expect(plan.counts.new).toBe(4);
    expect(plan.markdown).toBe(L1);
    expect(describePlan(plan)).toBe('First paste for this course. Everything is new.');
  });

  it('append: only the new lecture becomes the note', () => {
    const plan = planIncremental(L1, DOC);
    expect(plan.counts).toMatchObject({ new: 3, inserted: 0, revised: 0, skipped: 4, skippedLines: 4 });
    expect(plan.markdown).toBe(L2);
    expect(describePlan(plan)).toBe('3 new paragraphs, 4 lines skipped');
  });

  it('identical paste: nothing new', () => {
    const plan = planIncremental(DOC, DOC);
    expect(plan.nothingNew).toBe(true);
    expect(plan.markdown).toBe('');
    expect(plan.counts.skipped).toBe(7);
    expect(describePlan(plan)).toBe('Nothing new. 7 lines already stored.');
  });

  it('identical apart from whitespace and line endings: nothing new', () => {
    const noisy = DOC.replace(/\n\n/g, '\r\n\r\n\r\n').replace('sample space S is', 'sample  space S   is');
    expect(planIncremental(DOC, noisy).nothingNew).toBe(true);
  });

  it('revise: an edited earlier paragraph is included and marked as a revision', () => {
    const edited = DOC.replace('Events A and B are mutually exclusive when A ∩ B = ∅.', 'Events A and B are mutually exclusive (disjoint) when A ∩ B = ∅, so P(A ∪ B) = P(A) + P(B).');
    const plan = planIncremental(DOC, edited);
    expect(plan.counts).toMatchObject({ new: 0, inserted: 0, revised: 1 });
    const revised = plan.blocks.find((b) => b.status === 'revised')!;
    expect(revised.previous).toContain('mutually exclusive when');
    expect(plan.markdown).toBe(`${REVISED_MARK}\n\n${revised.text}`);
    expect(describePlan(plan)).toBe('0 new paragraphs, 1 revised, 6 lines skipped');
  });

  it('revise and append in one paste', () => {
    const L3 = '## Lecture 3: probability rules\n\nP(A^c) = 1 - P(A).';
    const edited = `${DOC.replace('is n!.', 'is n! (n factorial).')}\n\n${L3}`;
    const plan = planIncremental(DOC, edited);
    expect(plan.counts).toMatchObject({ new: 2, revised: 1 });
    expect(plan.markdown).toBe(`${REVISED_MARK}\n\nThe number of arrangements of n distinct objects is n! (n factorial).\n\n${L3}`);
  });

  it('a rewritten paragraph with little in common is new text, not a revision', () => {
    const edited = DOC.replace('The number of arrangements of n distinct objects is n!.', 'Tutorial this Friday covers permutations with repetition.');
    const plan = planIncremental(DOC, edited);
    expect(plan.counts).toMatchObject({ revised: 0, inserted: 1 });
    expect(plan.markdown).toBe(`${INSERTED_MARK}\n\nTutorial this Friday covers permutations with repetition.`);
  });

  it('insertion into an earlier section is marked as added there', () => {
    const edited = DOC.replace('## Lecture 2: counting', 'Example: rolling two dice gives 36 outcomes.\n\n## Lecture 2: counting');
    const plan = planIncremental(DOC, edited);
    expect(plan.counts).toMatchObject({ new: 0, inserted: 1, revised: 0 });
    expect(plan.markdown).toBe(`${INSERTED_MARK}\n\nExample: rolling two dice gives 36 outcomes.`);
  });

  it('reorder: moved paragraphs are not new material', () => {
    const reordered = `${L2}\n\n${L1}`;
    const plan = planIncremental(DOC, reordered);
    expect(plan.nothingNew).toBe(true);
    expect(plan.counts.skipped).toBe(7);
  });

  it('reorder plus one new paragraph: only that paragraph is new', () => {
    const reordered = `${L2}\n\n${L1}\n\nIndependence: P(A ∩ B) = P(A)P(B).`;
    const plan = planIncremental(DOC, reordered);
    expect(plan.counts).toMatchObject({ new: 1, inserted: 0, revised: 0, skipped: 7 });
    expect(plan.markdown).toBe('Independence: P(A ∩ B) = P(A)P(B).');
  });

  it('text from any earlier paste is not new, even if the last paste dropped it', () => {
    const plan = planIncremental(L2, DOC, [L1]);
    expect(plan.nothingNew).toBe(true);
  });

  it('with no stored paste, notes already saved for the course still count', () => {
    const plan = planIncremental(null, DOC, [L1]);
    expect(plan.hadPrevious).toBe(true);
    expect(plan.markdown).toBe(L2);
  });

  it('deleting text only: nothing new', () => {
    const plan = planIncremental(DOC, L1);
    expect(plan.nothingNew).toBe(true);
  });

  it('keeps an appended code block whole', () => {
    const code = '```r\nx <- rbinom(10, 5, 0.5)\n\nmean(x)\n```';
    const plan = planIncremental(DOC, `${DOC}\n\n${code}`);
    expect(plan.markdown).toBe(code);
  });
});
