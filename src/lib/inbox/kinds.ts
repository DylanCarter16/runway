import type { PasteKind } from '@/lib/ai/schemas';

// The paste box's kind menu. Shared by server and client code, so it lives
// outside any 'use client' file.

export const PASTE_KINDS: { value: PasteKind | 'detect'; label: string }[] = [
  { value: 'detect', label: 'Detect' },
  { value: 'lecture_notes', label: 'Lecture notes' },
  { value: 'outline', label: 'Course outline' },
  { value: 'announcement', label: 'Announcement' },
  { value: 'quest_schedule', label: 'Quest class schedule' },
  { value: 'odyssey_paste', label: 'Odyssey exam row' },
  { value: 'grade_paste', label: 'Grades' },
  { value: 'assignment_header', label: 'Assignment header' },
  { value: 'piazza_resources', label: 'Piazza resources' },
  { value: 'crowdmark_assessment', label: 'Crowdmark assessment' },
  { value: 'other', label: 'Other' },
];

/** documents.kind values and their labels, for Library filters. */
export const DOCUMENT_KIND_LABEL: Record<string, string> = {
  outline: 'Course outline',
  announcement: 'Announcement',
  piazza_email: 'Piazza email',
  piazza_resources: 'Piazza resources',
  crowdmark_email: 'Crowdmark email',
  crowdmark_assessment: 'Crowdmark assessment',
  page_snapshot: 'Page snapshot',
  assignment_pdf: 'Assignment PDF',
  assignment_header: 'Assignment header',
  quest_schedule: 'Quest class schedule',
  odyssey_paste: 'Odyssey exam row',
  grade_paste: 'Grades',
  resource: 'Resource',
  other: 'Other',
  upload: 'File',
  textbook: 'Textbook',
  note_source: 'Running notes paste',
};

export function documentKindLabel(kind: string): string {
  return DOCUMENT_KIND_LABEL[kind] ?? kind.replace(/_/g, ' ');
}
