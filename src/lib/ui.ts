// Plain constants shared by server pages and client components. Values exported from a
// 'use client' module arrive in server code as client references, so they live here.

export const COURSE_TABS = [
  ['overview', 'Overview'],
  ['deadlines', 'Deadlines'],
  ['notes', 'Notes'],
  ['ask', 'Ask'],
  ['resources', 'Resources'],
  ['updates', 'Updates'],
  ['grades', 'Grades'],
  ['library', 'Library'],
] as const;

export const SETTINGS_SECTIONS = [
  ['term', 'Term'],
  ['courses', 'Courses'],
  ['integrations', 'Integrations'],
  ['reminders', 'Reminders'],
  ['ai', 'AI'],
  ['sync', 'Sync'],
  ['data', 'Data'],
] as const;

export const selectClass =
  'h-11 w-full rounded-md border border-input bg-sheet px-3 text-base sm:h-9 sm:text-sm focus-visible:outline-2 focus-visible:outline-tie';
