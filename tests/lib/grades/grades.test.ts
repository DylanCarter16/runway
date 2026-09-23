import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TERM_F26 } from '@/config/term-f26';
import { parseGradePaste } from '@/lib/grades/parse';
import { courseStanding, formatPercent, guessComponent, neededOnFinal, type Mark, type SchemeComponent } from '@/lib/grades/scheme';

const fixture = (name: string) => readFileSync(path.join(__dirname, '../../fixtures', name), 'utf8');

function scheme(slug: string): SchemeComponent[] {
  const course = TERM_F26.courses.find((c) => c.slug === slug)!;
  return course.gradingScheme.map((g) => ({ component: g.component, weight_percent: g.weightPercent, notes: g.notes ?? null }));
}

let n = 0;
const mark = (label: string, score: number | null, outOf: number | null, component: string | null = null): Mark => ({
  id: `m${++n}`,
  label,
  score,
  out_of: outOf,
  component,
});

describe('grade paste parser', () => {
  it('reads a LEARN grades page: points first, percent-only rows, no headers or totals', () => {
    expect(parseGradePaste(fixture('grades/learn-stat230.txt')).map(({ label, score, out_of }) => ({ label, score, out_of }))).toEqual([
      { label: 'Workshop 1', score: 9, out_of: 10 },
      { label: 'Quiz 1', score: 16, out_of: 20 },
      { label: 'Midterm 1', score: 72, out_of: 100 },
    ]);
  });

  it('reads Crowdmark-style lines and drops "Score" from labels', () => {
    expect(parseGradePaste(fixture('grades/crowdmark-cs251.txt')).map(({ label, score, out_of }) => ({ label, score, out_of }))).toEqual([
      { label: 'Midterm', score: 41.5, out_of: 50 },
      { label: 'A1', score: 27, out_of: 30 },
      { label: 'Assignment 2', score: 22, out_of: 30 },
    ]);
  });

  it('reads nothing from an outline pasted as grades', () => {
    expect(parseGradePaste(fixture('ai/stat230-outline.txt'))).toEqual([]);
  });

  it('keeps the line as evidence', () => {
    const [m] = parseGradePaste('Quiz 3: 7.5 / 10');
    expect(m).toEqual({ label: 'Quiz 3', score: 7.5, out_of: 10, raw: 'Quiz 3: 7.5 / 10' });
  });
});

describe('guessComponent', () => {
  it('matches marks to the seeded schemes', () => {
    const stat = scheme('stat230');
    expect(guessComponent('Workshop 3', stat)).toBe('Workshops (best 4 of 5)');
    expect(guessComponent('Quiz 2', stat)).toBe('Quizzes (best 3 of 4)');
    expect(guessComponent('Midterm 2', stat)).toBe('Midterm 2');
    expect(guessComponent('MT1', stat)).toBe('Midterm 1');
    expect(guessComponent('Final exam', stat)).toBe('Final exam');

    const cs246 = scheme('cs246');
    expect(guessComponent('A1 part 2', cs246)).toBe('A1');
    expect(guessComponent('A5 project', cs246)).toBe('A5 (group project)');
    expect(guessComponent('A0', cs246)).toBeNull();

    const cs245 = scheme('cs245');
    expect(guessComponent('Quiz 4', cs245)).toBe('Marked quizzes');
    expect(guessComponent('Assignment 3', cs245)).toBe('Assignments');
    expect(guessComponent('Midterm', cs245)).toBe('Midterm');

    const cs251 = scheme('cs251');
    expect(guessComponent('A2', cs251)).toBe('Assignments (Crowdmark)');
    expect(guessComponent('Clicker week 3', cs251)).toBe('Clicker questions');
    expect(guessComponent('Lab 1', cs251)).toBeNull();
  });
});

describe('courseStanding', () => {
  it('averages over the graded weight only', () => {
    const s = courseStanding(scheme('cs251'), [mark('A1', 27, 30), mark('A2', 21, 30), mark('Midterm', 40, 50)]);
    const assignments = s.components.find((c) => c.component === 'Assignments (Crowdmark)')!;
    expect(assignments.percent).toBeCloseTo(80);
    expect(s.gradedWeight).toBe(45);
    // 0.8 × 20 + 0.8 × 25 = 36 points of 45
    expect(s.earned).toBeCloseTo(36);
    expect(s.average).toBeCloseTo(80);
    expect(s.totalWeight).toBe(100);
    expect(s.final?.component).toBe('Final exam');
  });

  it('keeps the best k marks of a "best k of n" component', () => {
    const s = courseStanding(scheme('stat230'), [mark('Quiz 1', 5, 10), mark('Quiz 2', 9, 10), mark('Quiz 3', 8, 10), mark('Quiz 4', 10, 10)]);
    const quizzes = s.components.find((c) => c.component.startsWith('Quizzes'))!;
    expect(quizzes.bestOf).toEqual({ keep: 3, of: 4 });
    expect(quizzes.percent).toBeCloseTo(90);
    expect(quizzes.marks.find((m) => m.label === 'Quiz 1')!.counted).toBe(false);
  });

  it('uses the picked component over the guess, and the item title before the label', () => {
    const s = courseStanding(scheme('stat230'), [
      mark('Quiz 1', 8, 10, 'Midterm 2'),
      { ...mark('Crowdmark submission', 7, 10), item_title: 'Workshop 2' },
      mark('Bonus', 1, 1),
    ]);
    expect(s.components.find((c) => c.component === 'Midterm 2')!.marks[0]).toMatchObject({ label: 'Quiz 1', guessed: false });
    expect(s.components.find((c) => c.component.startsWith('Workshops'))!.marks[0]).toMatchObject({ guessed: true });
    expect(s.unassigned.map((m) => m.label)).toEqual(['Bonus']);
  });

  it('ignores marks with no score and zero-weight components', () => {
    const s = courseStanding(scheme('stat230'), [mark('Quiz 1', null, 10), mark('iClicker', 50, 75)]);
    expect(s.average).toBeNull();
    expect(s.gradedWeight).toBe(0);
  });
});

describe('neededOnFinal', () => {
  it('fills unmarked components with the assumption', () => {
    const s = courseStanding(scheme('cs251'), [mark('A1', 24, 30), mark('Midterm', 35, 50)]);
    // earned: 0.8 × 20 + 0.7 × 25 = 33.5; clickers (5) at 80 add 4; final is 50
    const need = neededOnFinal(s, 70, 80)!;
    expect(need.remainingWeight).toBe(5);
    expect(need.finalWeight).toBe(50);
    expect(need.needed).toBeCloseTo(((70 - 33.5 - 4) / 50) * 100);
    expect(formatPercent(need.needed)).toBe('65%');
  });

  it('can say the target is already met or out of reach', () => {
    const s = courseStanding(scheme('cs251'), [mark('A1', 15, 30), mark('Midterm', 50, 50), mark('Clicker', 5, 5)]);
    // earned: 10 + 25 + 5 = 40 before the final (50)
    expect(neededOnFinal(s, 30, 0)!.needed).toBeLessThan(0);
    expect(neededOnFinal(s, 95, 0)!.needed).toBeCloseTo(110);
  });

  it('is null once the final is marked', () => {
    const s = courseStanding(scheme('cs251'), [mark('Final exam', 80, 100)]);
    expect(neededOnFinal(s, 70, 70)).toBeNull();
  });
});
