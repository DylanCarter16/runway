import { titleKey } from '@/lib/items/title-key';

// Running average from a course's grading scheme, and what the final needs.
// Each mark in a component counts the same. "Best k of n" in a component's name
// keeps the top k marks. Other rules in the notes (a higher midterm counting
// more, weight moving to the final) are shown, not applied.

export interface SchemeComponent {
  component: string;
  weight_percent: number | null;
  notes: string | null;
}

export interface Mark {
  id: string;
  label: string;
  score: number | null;
  out_of: number | null;
  /** Component Dylan picked; null means guess from the label. */
  component: string | null;
  /** Title of the linked item, a better guess than the pasted label. */
  item_title?: string | null;
}

export interface CountedMark extends Mark {
  percent: number | null;
  counted: boolean;
  guessed: boolean;
}

export interface ComponentStanding {
  component: string;
  weight: number;
  notes: string | null;
  marks: CountedMark[];
  /** Percent across the counted marks; null when nothing is marked. */
  percent: number | null;
  /** Course percentage points earned (percent × weight / 100). */
  earned: number | null;
  bestOf: { keep: number; of: number } | null;
}

export interface Standing {
  components: ComponentStanding[];
  /** Marks that match no component. They don't count toward the average. */
  unassigned: CountedMark[];
  /** Weight of components with at least one mark. */
  gradedWeight: number;
  earned: number;
  /** Running average over the graded weight; null before any mark. */
  average: number | null;
  totalWeight: number;
  final: ComponentStanding | null;
}

type Family = 'assignment' | 'quiz' | 'midterm' | 'workshop' | 'final' | 'clicker' | 'project' | 'tutorial';

/** Family named by words in a component name ("Marked quizzes", "Assignments (Crowdmark)"). */
function nameFamily(name: string): Family | null {
  const n = name.toLowerCase();
  if (/\bassignments?\b/.test(n)) return 'assignment';
  if (/\bquiz(?:zes)?\b/.test(n)) return 'quiz';
  if (/\bmidterms?\b/.test(n)) return 'midterm';
  if (/\bworkshops?\b/.test(n)) return 'workshop';
  if (/\bfinal\b/.test(n)) return 'final';
  if (/\b(?:clickers?|iclicker|poll)\b/.test(n)) return 'clicker';
  if (/\bprojects?\b/.test(n)) return 'project';
  if (/\btutorials?\b/.test(n)) return 'tutorial';
  return null;
}

/** Family of a mark's label, which may be short ("A3", "Q2", "MT1"). */
function labelFamily(label: string): Family | null {
  const k = titleKey(label);
  if (/^a\d/.test(k)) return 'assignment';
  if (/^q\d/.test(k)) return 'quiz';
  if (/^mt/.test(k)) return 'midterm';
  if (/^w\d/.test(k)) return 'workshop';
  return nameFamily(label);
}

export function guessComponent(label: string, scheme: SchemeComponent[]): string | null {
  const k = titleKey(label);
  if (!k) return null;
  const keyed = scheme.map((c) => ({ name: c.component, key: titleKey(c.component) }));
  const exact = keyed.find((c) => c.key === k);
  if (exact) return exact.name;
  // "A1 part 2" counts toward "A1"; "A5 project" toward "A5 (group project)". Not "A10".
  const prefix = keyed.find((c) => /\d$/.test(c.key) && k.startsWith(c.key) && !/^\d/.test(k.slice(c.key.length)));
  if (prefix) return prefix.name;
  const family = labelFamily(label);
  if (!family) return null;
  return scheme.find((c) => nameFamily(c.component) === family)?.component ?? null;
}

export function markPercent(m: Pick<Mark, 'score' | 'out_of'>): number | null {
  if (m.score === null || m.out_of === null || !(m.out_of > 0)) return null;
  return (m.score / m.out_of) * 100;
}

function bestOf(name: string): { keep: number; of: number } | null {
  const m = /best\s+(\d+)\s+of\s+(\d+)/i.exec(name);
  return m ? { keep: Number(m[1]), of: Number(m[2]) } : null;
}

export function componentOf(mark: Mark, scheme: SchemeComponent[]): { name: string | null; guessed: boolean } {
  if (mark.component && scheme.some((c) => c.component === mark.component)) return { name: mark.component, guessed: false };
  const name = (mark.item_title ? guessComponent(mark.item_title, scheme) : null) ?? guessComponent(mark.label, scheme);
  return { name, guessed: true };
}

export function courseStanding(scheme: SchemeComponent[], marks: Mark[]): Standing {
  const byComponent = new Map<string, CountedMark[]>();
  const unassigned: CountedMark[] = [];
  for (const mark of marks) {
    const { name, guessed } = componentOf(mark, scheme);
    const counted: CountedMark = { ...mark, percent: markPercent(mark), counted: false, guessed };
    if (name) byComponent.set(name, [...(byComponent.get(name) ?? []), counted]);
    else unassigned.push(counted);
  }

  const components = scheme.map((c): ComponentStanding => {
    const weight = c.weight_percent ?? 0;
    const list = byComponent.get(c.component) ?? [];
    const rule = bestOf(c.component);
    const scored = list.filter((m) => m.percent !== null).sort((a, b) => b.percent! - a.percent!);
    const kept = rule ? scored.slice(0, rule.keep) : scored;
    for (const m of kept) m.counted = true;
    const percent = kept.length ? kept.reduce((s, m) => s + m.percent!, 0) / kept.length : null;
    return {
      component: c.component,
      weight,
      notes: c.notes,
      marks: list,
      percent,
      earned: percent === null ? null : (percent * weight) / 100,
      bestOf: rule,
    };
  });

  const graded = components.filter((c) => c.percent !== null && c.weight > 0);
  const gradedWeight = graded.reduce((s, c) => s + c.weight, 0);
  const earned = graded.reduce((s, c) => s + c.earned!, 0);
  return {
    components,
    unassigned,
    gradedWeight,
    earned,
    average: gradedWeight > 0 ? (earned / gradedWeight) * 100 : null,
    totalWeight: components.reduce((s, c) => s + c.weight, 0),
    final: components.find((c) => nameFamily(c.component) === 'final' && c.weight > 0) ?? null,
  };
}

export interface FinalNeed {
  /** Percent needed on the final; may be below 0 or above 100. */
  needed: number;
  finalWeight: number;
  /** Weight of other components with no marks yet, filled with the assumption. */
  remainingWeight: number;
}

/**
 * What the final needs for a target course grade, assuming `assumePercent` on
 * every other component that has no marks yet. Null when there is no final in
 * the scheme or it is already marked.
 */
export function neededOnFinal(standing: Standing, target: number, assumePercent: number): FinalNeed | null {
  const final = standing.final;
  if (!final || final.percent !== null) return null;
  const remainingWeight = standing.components
    .filter((c) => c !== final && c.weight > 0 && c.percent === null)
    .reduce((s, c) => s + c.weight, 0);
  const needed = ((target - standing.earned - (assumePercent * remainingWeight) / 100) / final.weight) * 100;
  return { needed, finalWeight: final.weight, remainingWeight };
}

export function formatPercent(n: number): string {
  return `${(Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, '')}%`;
}
