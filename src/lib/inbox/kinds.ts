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
