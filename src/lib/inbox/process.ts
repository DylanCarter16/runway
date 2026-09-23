import type { ClaudeRequest, ClaudeResult } from '@/lib/ai/client';
import { ANNOUNCEMENT_SYSTEM, CLASSIFY_SYSTEM, GRADES_SYSTEM, OUTLINE_SYSTEM, QUEST_SYSTEM, itemsSystem, type ItemsPurpose } from '@/lib/ai/prompts';
import { userTurn, type PromptContext } from '@/lib/ai/prompts/shared';
import {
  announcementResult,
  classifyResult,
  gradesResult,
  itemsResult,
  outlineResult,
  questResult,
  type PasteKind,
} from '@/lib/ai/schemas';
import { aiAllowed } from '@/lib/ai/switch';
import { parseOdyssey } from '@/lib/sources/odyssey';
import { parseQuestSchedule, type MeetingJson } from '@/lib/sources/quest';
import {
  announcementToProposals,
  contextItems,
  courseByCode,
  draftsToProposals,
  gradesToProposals,
  odysseyToProposals,
  outlineToProposals,
  questToProposals,
  type DraftContext,
} from './plan';
import type { CourseCtx, ItemCtx, PlannedProposal } from './types';

// What happens to one pasted document (SPEC 4.4). Rule-based parsers run first
// for Quest schedules and Odyssey rows. Claude runs only when the document's
// course has its AI switch on; everything else is stored and nothing more.

export type Claude = <T>(req: ClaudeRequest<T>) => Promise<ClaudeResult<T>>;

export interface ProcessInput {
  userId: string;
  doc: { id: string; course_id: string | null; raw_text: string; source_url: string | null };
  /** What Dylan picked in the kind menu. */
  declaredKind: PasteKind | 'detect';
  courses: CourseCtx[];
  items: ItemCtx[];
  today: string;
  term: PromptContext['term'];
}

export type ProcessStatus =
  /** AI is off for the course (or there is no course) and no rule-based parser applied. */
  | 'stored_only'
  /** Proposals were made, or the source was read and nothing needs changing. */
  | 'extracted'
  /** The classifier thinks this is lecture notes; the UI offers to save it as a note. */
  | 'suggest_note';

export interface ProcessResult {
  status: ProcessStatus;
  /** Final document kind (documents.kind); lecture notes stay 'other'. */
  kind: Exclude<PasteKind, 'lecture_notes'>;
  detectedKind: PasteKind | null;
  /** Course the classifier picked, when the paste had none. */
  courseId: string | null;
  proposals: PlannedProposal[];
  summary: string | null;
  importance: string | null;
  /** Human-readable notes for the Library page ("No course named CS 136"). */
  notes: string[];
  usedAi: boolean;
}

function courseLookup(courses: CourseCtx[]) {
  return async (id: string) => courses.find((c) => c.id === id) ?? null;
}

/** Cheap sniffing before any AI: tables Runway can read by itself. */
export function sniffKind(text: string): 'quest_schedule' | 'odyssey_paste' | null {
  if (parseQuestSchedule(text).length) return 'quest_schedule';
  const rows = parseOdyssey(text);
  if (rows.length && rows.some((r) => r.seat || r.location) && /seat|midterm|final|exam/i.test(text)) return 'odyssey_paste';
  return null;
}

const ITEMS_PURPOSE: Partial<Record<PasteKind, ItemsPurpose>> = {
  odyssey_paste: 'extract_odyssey',
  assignment_header: 'extract_assignment_header',
  crowdmark_assessment: 'extract_crowdmark',
  other: 'extract_generic',
};

function result(partial: Partial<ProcessResult> & Pick<ProcessResult, 'status' | 'kind'>): ProcessResult {
  return { detectedKind: null, courseId: null, proposals: [], summary: null, importance: null, notes: [], usedAi: false, ...partial };
}

export async function processDocument(input: ProcessInput, claude: Claude): Promise<ProcessResult> {
  const { doc, courses, items } = input;
  const text = doc.raw_text;
  let kind: PasteKind | 'detect' = input.declaredKind;
  const notes: string[] = [];

  if (kind === 'detect') kind = sniffKind(text) ?? 'detect';

  // Rule-based tables first. No AI involved, whatever the course's switch says.
  if (kind === 'quest_schedule') {
    const parsed = parseQuestSchedule(text);
    const { proposals, unknownCodes } = questToProposals(parsed, courses);
    if (unknownCodes.length) notes.push(`Not in this term: ${unknownCodes.join(', ')}.`);
    if (parsed.length) return result({ status: 'extracted', kind, proposals, notes });
  }
  if (kind === 'odyssey_paste') {
    const rows = parseOdyssey(text);
    const { proposals, unknownCodes } = odysseyToProposals(rows, courses, items);
    if (unknownCodes.length) notes.push(`Not in this term: ${unknownCodes.join(', ')}.`);
    if (rows.length) return result({ status: 'extracted', kind, proposals, notes });
  }

  // Everything below may call Claude, so the course switch decides.
  const clearance = await aiAllowed(courseLookup(courses), doc.course_id);
  if (!clearance) {
    const course = courses.find((c) => c.id === doc.course_id);
    notes.push(course ? `${course.code} has AI turned off, so this was stored without extraction.` : 'Stored without a course, so nothing was extracted.');
    return result({ status: 'stored_only', kind: kind === 'detect' ? 'other' : kind === 'lecture_notes' ? 'other' : kind, notes });
  }

  const course = courses.find((c) => c.id === clearance.courseId)!;
  const ctx: PromptContext = {
    today: input.today,
    term: input.term,
    courses: courses.map((c) => ({ slug: c.slug, code: c.code, title: c.title })),
    items: contextItems(items, courses, course.id),
  };
  const base = { clearance, userId: input.userId, requestRef: doc.id };
  let detectedKind: PasteKind | null = null;

  if (kind === 'detect') {
    const { data } = await claude({
      ...base,
      purpose: 'classify',
      system: CLASSIFY_SYSTEM,
      user: userTurn(ctx, 'unknown', course.slug, text),
      schema: classifyResult,
      maxTokens: 2000,
      effort: 'low',
    });
    detectedKind = data.kind;
    kind = data.kind;
    if (kind === 'lecture_notes') {
      return result({ status: 'suggest_note', kind: 'other', detectedKind, usedAi: true, notes });
    }
  }

  const draftCtx: DraftContext = { courses, items, defaultCourseId: course.id, source: 'paste', sourceUrl: doc.source_url };
  const common = { detectedKind, usedAi: true, notes };
  const onlyThisCourse = courses.filter((c) => c.id === course.id);

  switch (kind) {
    case 'outline': {
      const { data } = await claude({ ...base, purpose: 'extract_outline', system: OUTLINE_SYSTEM, user: userTurn(ctx, kind, course.slug, text), schema: outlineResult });
      return result({ status: 'extracted', kind, proposals: outlineToProposals(data, draftCtx), ...common });
    }
    case 'announcement':
    case 'piazza_resources': {
      const { data } = await claude({
        ...base,
        purpose: 'extract_announcement',
        system: ANNOUNCEMENT_SYSTEM,
        user: userTurn(ctx, kind, course.slug, text),
        schema: announcementResult,
      });
      return result({
        status: 'extracted',
        kind,
        proposals: announcementToProposals(data, draftCtx),
        summary: data.summary,
        importance: data.importance,
        ...common,
      });
    }
    case 'grade_paste': {
      const { data } = await claude({ ...base, purpose: 'extract_grades', system: GRADES_SYSTEM, user: userTurn(ctx, kind, course.slug, text), schema: gradesResult });
      return result({ status: 'extracted', kind, proposals: gradesToProposals(data, draftCtx), ...common });
    }
    case 'quest_schedule': {
      // Fallback for a schedule the rule-based parser couldn't read. Only this course's rows count.
      const { data } = await claude({ ...base, purpose: 'extract_quest', system: QUEST_SYSTEM, user: userTurn(ctx, kind, course.slug, text), schema: questResult });
      const mine = data.meetings.filter((m) => courseByCode(onlyThisCourse, m.course_code));
      const parsed = mine.length
        ? [
            {
              code: course.code,
              title: course.title,
              meetings: mine.map(
                (m): MeetingJson => ({
                  component: m.component,
                  section: m.section,
                  class_number: null,
                  days: m.days,
                  start: m.start_time,
                  end: m.end_time,
                  location: m.location,
                  instructor: null,
                  starts_on: m.start_date,
                  ends_on: m.end_date,
                }),
              ),
            },
          ]
        : [];
      const drafts = data.items.filter((d) => !d.course_slug || d.course_slug === course.slug);
      const proposals = [...questToProposals(parsed, onlyThisCourse).proposals, ...draftsToProposals(drafts, draftCtx)];
      return result({ status: 'extracted', kind, proposals, ...common });
    }
    default: {
      const purpose = ITEMS_PURPOSE[kind] ?? 'extract_generic';
      const { data } = await claude({ ...base, purpose, system: itemsSystem(purpose), user: userTurn(ctx, kind, course.slug, text), schema: itemsResult });
      return result({ status: 'extracted', kind: kind as ProcessResult['kind'], proposals: draftsToProposals(data.items, draftCtx), ...common });
    }
  }
}

