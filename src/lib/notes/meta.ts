import { NOTE_META_SYSTEM } from '@/lib/ai/prompts';
import { userTurn, type PromptContext } from '@/lib/ai/prompts/shared';
import { noteMetaResult } from '@/lib/ai/schemas';
import { assertAiAllowed } from '@/lib/ai/switch';
import { contextItems, draftsToProposals } from '@/lib/inbox/plan';
import type { Claude } from '@/lib/inbox/process';
import type { CourseCtx, ItemCtx, PlannedProposal } from '@/lib/inbox/types';

// Note metadata (docs/PROMPTS.md section 9, Phase 5 task 3): title, topics,
// summary, open questions, and dates the note mentions, which become proposals
// linked to the note. Runs on the cleaned copy, or the original when cleanup failed.

export interface NoteMetaInput {
  userId: string;
  noteId: string;
  courseId: string | null;
  lectureOn: string | null;
  text: string;
  courses: CourseCtx[];
  items: ItemCtx[];
  today: string;
  term: PromptContext['term'];
}

export interface NoteMeta {
  title: string;
  topics: string[];
  summary: string;
  openQuestions: string[];
  proposals: PlannedProposal[];
}

function unique(values: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = v.trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** Throws AiNotAllowedError for AI-off courses before any prompt is built. */
export async function noteMetadata(input: NoteMetaInput, claude: Claude): Promise<NoteMeta> {
  const clearance = await assertAiAllowed(async (id) => input.courses.find((c) => c.id === id) ?? null, input.courseId);
  const course = input.courses.find((c) => c.id === clearance.courseId)!;
  const ctx: PromptContext = {
    today: input.today,
    term: input.term,
    courses: input.courses.map((c) => ({ slug: c.slug, code: c.code, title: c.title })),
    items: contextItems(input.items, input.courses, course.id),
  };
  const { data } = await claude({
    purpose: 'note_meta',
    clearance,
    userId: input.userId,
    requestRef: input.noteId,
    system: NOTE_META_SYSTEM,
    user: userTurn(ctx, 'lecture_notes', course.slug, input.text, input.lectureOn ? { lecture_date: input.lectureOn } : {}),
    schema: noteMetaResult,
    effort: 'low',
  });
  return {
    title: data.title.trim().slice(0, 120),
    topics: unique(
      data.topics.map((t) => t.toLowerCase()),
      8,
    ),
    summary: data.summary.trim().slice(0, 400),
    openQuestions: unique(data.open_questions, 20),
    proposals: draftsToProposals(data.items, {
      courses: input.courses,
      items: input.items,
      defaultCourseId: course.id,
      source: 'note',
    }),
  };
}
