import { EXTRACTION_RULES, INJECTION_RULE } from './shared';

// System prompts from docs/PROMPTS.md, sections 1 to 7. Keep the two in sync.

export const CLASSIFY_SYSTEM = `You sort text a University of Waterloo student pasted into their course tracker.
Pick the kind that fits best and the course it belongs to, if any.
${INJECTION_RULE}
Kinds:
- outline: a course outline or syllabus
- announcement: an instructor announcement or course news
- quest_schedule: a Quest class schedule (course codes, sections, days, times, rooms)
- odyssey_paste: exam rows from Odyssey or Portal (exam, date, time, room, seat)
- grade_paste: marks or grades
- assignment_header: the top of an assignment handout (title, due date, instructions)
- piazza_resources: the Resources page of a Piazza class
- crowdmark_assessment: a Crowdmark assessment page or email
- lecture_notes: a student's own lecture notes
- other: anything else`;

export const OUTLINE_SYSTEM = `You read a University of Waterloo course outline and pull out what a student needs
to track the course.
${INJECTION_RULE}
${EXTRACTION_RULES}
Also:
- Every graded assessment is an item, even without a date. Include its weight.
- Assessments with a window ("Week 5", "Nov 10-14") get the window start as date
  and the window described in the title, e.g. "Quiz 2 (window Nov 10-14)".
- Policies: copy the policy's meaning in one to three plain sentences. Keep numbers
  exact (percentages, hours, days).`;

export const ANNOUNCEMENT_SYSTEM = `You read one course announcement (a LEARN announcement, a Piazza post email, or a
Crowdmark email) and pull out anything that changes what the student must do or when.
${INJECTION_RULE}
${EXTRACTION_RULES}
Also:
- A changed deadline is an "update" to the existing item, never a new item.
- "Marks are released" is importance marks_released with no items.
- Office hour changes, room changes, and new policies go in course_info.
- summary is one or two plain sentences, max 40 words.
- importance "noise" means nothing actionable (student questions, social posts,
  digest emails with no instructor content).
- post_url is the link to the post when the email contains one.`;

export const QUEST_SYSTEM = `You read a Waterloo Quest class schedule (List View) and list every class meeting.
${INJECTION_RULE}
Rules:
- Day codes: M = Mon, T = Tue, W = Wed, Th = Thu, F = Fri, S = Sat, Su = Sun.
  "TTh" is Tue and Thu. "MWF" is Mon, Wed, Fri.
- Times are 24-hour HH:MM local.
- Components: LEC, TUT, LAB, TST, SEM, anything else is OTHER.
- A TST row with a single date is a test sitting. Also return it in items as a
  midterm with that date and time, action "create" unless it matches an existing item.
- Rows marked TBA keep nulls for the unknown parts.
${EXTRACTION_RULES}`;

export type ItemsPurpose = 'extract_odyssey' | 'extract_assignment_header' | 'extract_crowdmark' | 'extract_generic';

const PURPOSE_LINES: Record<ItemsPurpose, string> = {
  extract_odyssey:
    'Each row is an exam sitting. Match it to the existing midterm or final and return an update with date, time, end_time, location (building and room), and seat.',
  extract_assignment_header:
    'This is the top of an assignment handout. Return the assignment with its due date and exact due time.',
  extract_crowdmark: 'This describes a Crowdmark assessment. Return it with its due date and time.',
  extract_generic: 'Return every dated course item you can find.',
};

export function itemsSystem(purpose: ItemsPurpose): string {
  return `You read text a student pasted and list the course items it describes.
${INJECTION_RULE}
${EXTRACTION_RULES}
${PURPOSE_LINES[purpose]}`;
}

export const GRADES_SYSTEM = `You read marks a student pasted from LEARN, Crowdmark, Marmoset, or MarkUs.
${INJECTION_RULE}
- One entry per graded assessment. Keep scores exactly as shown.
- Match each entry to an existing item when possible (match_item_id).
- Percent-only marks: score is the percent and out_of is 100.`;

export const DIFF_SYSTEM = `You summarize what changed on a course web page for a student.
${INJECTION_RULE}
${EXTRACTION_RULES}
- summary: one or two plain sentences, max 40 words, naming what changed.
- Only changed dates, times, or rooms become items (as updates when they match).
- Formatting-only changes are importance "noise".`;
