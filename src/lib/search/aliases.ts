import type { ItemKind } from '@/config/term.template';

export interface CourseRef {
  id: string;
  code: string; // 'CS 251'
  slug: string; // 'cs251'
}

export interface ExpandedQuery {
  /** Text passed to search_all, with aliases rewritten. Empty when the query named only a course. */
  text: string;
  course: CourseRef | null;
  kind: ItemKind | null;
}

const KIND_ALIASES: Record<string, { kind: ItemKind; text: string }> = {
  mt: { kind: 'midterm', text: 'midterm' },
  mts: { kind: 'midterm', text: 'midterm' },
  midterm: { kind: 'midterm', text: 'midterm' },
  midterms: { kind: 'midterm', text: 'midterm' },
  final: { kind: 'final', text: 'final' },
  finals: { kind: 'final', text: 'final' },
};

function findCourse(query: string, courses: CourseRef[]): { course: CourseRef; rest: string } | null {
  // "cs251", "CS 251", "cs-251", "stat230"
  const coded = /\b([a-z]{2,5})[\s-]?(\d{3}[a-z]?)\b/i;
  const match = coded.exec(query);
  if (match) {
    const slug = `${match[1]}${match[2]}`.toLowerCase();
    const course = courses.find((c) => c.slug === slug);
    if (course) return { course, rest: query.replace(match[0], ' ') };
  }
  // A bare course number, when exactly one course has it: "251"
  const numbered = /\b(\d{3})\b/g;
  for (const m of query.matchAll(numbered)) {
    const hits = courses.filter((c) => c.slug.replace(/^[a-z]+/, '') === m[1]);
    if (hits.length === 1) return { course: hits[0], rest: query.replace(m[0], ' ') };
  }
  return null;
}

/**
 * Rewrites a search box query before it reaches search_all:
 * a course code or number becomes a course filter, "a3" becomes "A3",
 * and "mt", "midterm", or "final" pick an item kind.
 */
export function expandQuery(raw: string, courses: CourseRef[]): ExpandedQuery {
  let rest = raw.trim().replace(/\s+/g, ' ');
  let course: CourseRef | null = null;
  const found = findCourse(rest, courses);
  if (found) {
    course = found.course;
    rest = found.rest;
  }

  let kind: ItemKind | null = null;
  const words = rest
    .split(' ')
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      const alias = KIND_ALIASES[lower];
      if (alias) {
        kind = alias.kind;
        return alias.text;
      }
      // Numbered assessments: a3, q2, m1, w4, A1
      if (/^[a-z]\d{1,2}$/i.test(word)) return word.toUpperCase();
      return word;
    });

  return { text: words.join(' '), course, kind };
}
