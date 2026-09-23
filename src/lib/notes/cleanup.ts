import type { TextRequest, TextResult } from '@/lib/ai/client';
import { cleanupSystem } from '@/lib/ai/prompts';
import { escapeSource } from '@/lib/ai/prompts/shared';
import { assertAiAllowed, type AiClearance, type CourseLookup } from '@/lib/ai/switch';
import { changedSpans, FORMULA_WARNING } from './checks';
import { splitForCleanup } from './split';

// Note cleanup (docs/PROMPTS.md section 8, Phase 5 task 2). The AI switch is
// checked before any prompt is built, so AI-off notes never reach Claude. Parts
// are cleaned one call each; the job runs several per step when they are small
// and chains steps when they are not.

export type ClaudeText = (req: TextRequest) => Promise<TextResult>;

export interface CleanupCourse {
  id: string;
  code: string;
  title: string;
  ai_allowed: boolean;
}

export interface CleanupNote {
  id: string;
  course_id: string | null;
  lecture_on: string | null;
  original_md: string;
}

export interface CleanupPlan {
  clearance: AiClearance;
  course: CleanupCourse;
  parts: string[];
}

/** Throws AiNotAllowedError for AI-off or course-less notes. */
export async function planCleanup(note: CleanupNote, courses: CleanupCourse[]): Promise<CleanupPlan> {
  const lookup: CourseLookup = async (id) => courses.find((c) => c.id === id) ?? null;
  const clearance = await assertAiAllowed(lookup, note.course_id);
  const course = courses.find((c) => c.id === clearance.courseId)!;
  return { clearance, course, parts: splitForCleanup(note.original_md) };
}

export function cleanupUserTurn(opts: {
  course: CleanupCourse;
  lectureOn: string | null;
  index: number;
  count: number;
  instruction: string | null;
  text: string;
}): string {
  const i = opts.index + 1;
  return [
    `<course>${opts.course.code} ${opts.course.title}</course>`,
    `<lecture_date>${opts.lectureOn ?? 'unknown'}</lecture_date>`,
    `<part index="${i}" of="${opts.count}">`,
    ...(i > 1 ? ["Continue the structure of earlier parts. Don't repeat their headings."] : []),
    '</part>',
    `<instruction>${opts.instruction?.trim() ? escapeSource(opts.instruction.trim()) : 'none'}</instruction>`,
    '<source kind="lecture_notes">',
    escapeSource(opts.text),
    '</source>',
  ].join('\n');
}

/** Drops a ```markdown fence wrapped around the whole answer. */
export function unwrapMarkdown(text: string): string {
  const m = /^\s*```(?:markdown|md)\s*\n([\s\S]*?)\n```\s*$/i.exec(text);
  return (m ? m[1] : text).trim();
}

export interface PartRequest {
  userId: string;
  note: CleanupNote;
  plan: CleanupPlan;
  index: number;
  instruction: string | null;
  style: string | null;
}

export async function cleanPart(req: PartRequest, claude: ClaudeText): Promise<{ text: string; model: string }> {
  const { plan, index } = req;
  const res = await claude({
    purpose: 'cleanup',
    clearance: plan.clearance,
    userId: req.userId,
    requestRef: req.note.id,
    system: cleanupSystem(req.style),
    user: cleanupUserTurn({
      course: plan.course,
      lectureOn: req.note.lecture_on,
      index,
      count: plan.parts.length,
      instruction: req.instruction,
      text: plan.parts[index],
    }),
    // A 3,000 token part comes back a little longer; low effort keeps a part inside one job step.
    maxTokens: 8000,
    effort: 'low',
  });
  return { text: unwrapMarkdown(res.text), model: res.model };
}

/** Joins the cleaned parts and runs the formula and code check. */
export function finishCleanup(original: string, cleanedParts: string[]): { cleaned: string; warnings: string[] } {
  const cleaned = cleanedParts.join('\n\n');
  return { cleaned, warnings: changedSpans(original, cleaned).length ? [FORMULA_WARNING] : [] };
}

/** Every part in sequence: for tests and short notes. */
export async function cleanupNote(
  input: { userId: string; note: CleanupNote; courses: CleanupCourse[]; instruction?: string | null; style?: string | null },
  claude: ClaudeText,
): Promise<{ cleaned: string; warnings: string[]; model: string }> {
  const plan = await planCleanup(input.note, input.courses);
  const parts: string[] = [];
  let model = '';
  for (let i = 0; i < plan.parts.length; i++) {
    const r = await cleanPart(
      { userId: input.userId, note: input.note, plan, index: i, instruction: input.instruction ?? null, style: input.style ?? null },
      claude,
    );
    parts.push(r.text);
    model = r.model;
  }
  return { ...finishCleanup(input.note.original_md, parts), model };
}
