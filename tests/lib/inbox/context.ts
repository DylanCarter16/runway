import type { CourseCtx, ItemCtx } from '@/lib/inbox/types';

// A small fake term for the inbox tests and for recording AI fixtures
// (.scratch/record-ai.ts). Changing it means re-recording tests/fixtures/ai.

export const IDS = {
  stat230: '00000000-0000-4000-8000-000000000230',
  cs245: '00000000-0000-4000-8000-000000000245',
  cs246: '00000000-0000-4000-8000-000000000246',
  cs251: '00000000-0000-4000-8000-000000000251',
  statQuiz1: '00000000-0000-4000-8000-00000000a001',
  csMidterm: '00000000-0000-4000-8000-00000000b001',
  doc: '00000000-0000-4000-8000-00000000d001',
  user: '00000000-0000-4000-8000-00000000e001',
};

export const COURSES: CourseCtx[] = [
  { id: IDS.stat230, slug: 'stat230', code: 'STAT 230', title: 'Probability', ai_allowed: true, meetings: [] },
  { id: IDS.cs245, slug: 'cs245', code: 'CS 245', title: 'Logic and Computation', ai_allowed: false, meetings: [] },
  { id: IDS.cs246, slug: 'cs246', code: 'CS 246', title: 'Object-Oriented Software Development', ai_allowed: false, meetings: [] },
  { id: IDS.cs251, slug: 'cs251', code: 'CS 251', title: 'Computer Organization and Design', ai_allowed: false, meetings: [] },
];

export const ITEMS: ItemCtx[] = [
  {
    id: IDS.statQuiz1,
    course_id: IDS.stat230,
    kind: 'quiz',
    title: 'Quiz 1',
    // Wed Oct 7, 2026, local midnight (EDT), date only.
    due_at: '2026-10-07T04:00:00.000Z',
    starts_at: null,
    ends_at: null,
    all_day: true,
    time_known: false,
    location: null,
    seat: null,
    weight_percent: null,
    state: 'active',
  },
  {
    id: IDS.csMidterm,
    course_id: IDS.cs251,
    kind: 'midterm',
    title: 'Midterm',
    // Thu Nov 12, 2026, 4:30 to 6:20 pm EST.
    due_at: '2026-11-12T21:30:00.000Z',
    starts_at: '2026-11-12T21:30:00.000Z',
    ends_at: '2026-11-12T23:20:00.000Z',
    all_day: false,
    time_known: true,
    location: null,
    seat: null,
    weight_percent: 30,
    state: 'active',
  },
];

export const TERM = { code: '1269', name: 'Fall 2026', startsOn: '2026-09-09', endsOn: '2026-12-22' };
export const TODAY = '2026-10-02';
