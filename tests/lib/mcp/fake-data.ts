import type { McpCourse, McpData, McpItem, McpNote, McpNoteBody } from '@/lib/mcp/server';
import { fromTorontoLocal } from '@/lib/time';

// An in-memory McpData for the MCP tests: STAT 230 with AI on, CS 251 with AI off.

export const STAT = '11111111-1111-4111-8111-111111111111';
export const CS = '22222222-2222-4222-8222-222222222222';
export const STAT_NOTE = '33333333-3333-4333-8333-333333333333';
export const CS_NOTE = '44444444-4444-4444-8444-444444444444';
export const LOOSE_NOTE = '55555555-5555-4555-8555-555555555555';
export const MIDTERM = '66666666-6666-4666-8666-666666666666';
export const A1 = '77777777-7777-4777-8777-777777777777';

export const CS_SECRET = 'CS251 SECRET TEXT';
export const CS_NOTE_BODY = 'CS251 NOTE BODY about graphs';

const courses: McpCourse[] = [
  {
    id: STAT, code: 'STAT 230', slug: 'stat230', title: 'Probability', ai_allowed: true, site_url: null,
    outline_url: 'https://outline.uwaterloo.ca/stat230', late_policy: null, grading_scheme: [{ component: 'Midterm 1', weight_percent: 25 }],
  },
  {
    id: CS, code: 'CS 251', slug: 'cs251', title: 'Computer Organization and Design', ai_allowed: false, site_url: 'https://student.cs.uwaterloo.ca/~cs251/',
    outline_url: null, late_policy: 'No late work', grading_scheme: [],
  },
];

function item(over: Partial<McpItem> & Pick<McpItem, 'id' | 'title'>): McpItem {
  return {
    course_id: null, kind: 'assignment', description: null, starts_at: null, due_at: null, ends_at: null, all_day: false,
    time_known: true, location: null, seat: null, weight_percent: null, progress: 'todo', flags: [], source: 'seed', source_url: null,
    ...over,
  };
}

const at = (date: string, time: string | null) => fromTorontoLocal(date, time).toISOString();

export const ITEMS: McpItem[] = [
  item({
    id: MIDTERM, course_id: STAT, kind: 'midterm', title: 'STAT 230 Midterm 1', description: 'Covers chapters 1 to 4',
    starts_at: at('2026-10-08', '19:00'), ends_at: at('2026-10-08', '20:30'), location: 'M3 1006', seat: '57', weight_percent: 25,
  }),
  item({
    id: A1, course_id: CS, title: 'A1', description: CS_SECRET, due_at: at('2026-10-03', '22:00'), source: 'cs251_assignments',
    source_url: 'https://student.cs.uwaterloo.ca/~cs251/assignments.html',
  }),
  item({ id: '88888888-8888-4888-8888-888888888888', course_id: CS, title: 'A0', due_at: at('2026-09-26', '22:00'), progress: 'submitted' }),
  item({ id: '99999999-9999-4999-8999-999999999999', course_id: STAT, kind: 'quiz', title: 'Quiz 2', due_at: at('2026-11-06', '15:30') }),
  item({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', kind: 'break', title: 'Reading week', description: 'No classes',
    starts_at: at('2026-10-10', null), all_day: true, time_known: false,
  }),
];

const NOTES: McpNoteBody[] = [
  {
    id: STAT_NOTE, course_id: STAT, lecture_on: '2026-09-21', title: 'Independence', topics: ['independence'], summary: 'Independent events.',
    open_questions: [], body: 'Events $A$ and $B$ are independent when $P(A \\cap B) = P(A)P(B)$.',
  },
  { id: CS_NOTE, course_id: CS, lecture_on: '2026-09-22', title: 'Graphs', topics: [], summary: null, open_questions: [], body: CS_NOTE_BODY },
  { id: LOOSE_NOTE, course_id: null, lecture_on: null, title: 'Loose graphs note', topics: [], summary: null, open_questions: [], body: 'no course' },
];

const meta = ({ body: _b, ...n }: McpNoteBody): McpNote => (void _b, n);
const has = (s: string | null, text: string) => !!s && s.toLowerCase().includes(text.toLowerCase());

/** `leaky` ignores the course ids the note methods get, to prove the tools filter again. */
export function fakeData({ leaky = false }: { leaky?: boolean } = {}): McpData & { calls: string[] } {
  const calls: string[] = [];
  const allowedNote = (n: McpNoteBody, ids: string[]) => leaky || (!!n.course_id && ids.includes(n.course_id));
  return {
    calls,
    async courses() {
      return courses;
    },
    async itemsBetween(from, to, courseId) {
      calls.push(`itemsBetween ${from.toISOString()} ${to.toISOString()}`);
      return ITEMS.filter((i) => {
        const t = Date.parse(i.due_at ?? i.starts_at ?? '');
        return t >= from.getTime() && t < to.getTime() && (!courseId || i.course_id === courseId);
      });
    },
    async item(id) {
      return ITEMS.find((i) => i.id === id) ?? null;
    },
    async searchItems(text, courseId, limit) {
      calls.push(`searchItems ${text}`);
      return ITEMS.filter((i) => (!text || has(i.title, text) || has(i.description, text) || has(i.location, text)) && (!courseId || i.course_id === courseId)).slice(0, limit);
    },
    async notes(ids, limit) {
      calls.push(`notes ${ids.join(',')}`);
      return NOTES.filter((n) => allowedNote(n, ids)).slice(0, limit).map(meta);
    },
    async note(id) {
      const n = NOTES.find((x) => x.id === id);
      return n ? { ...n } : null;
    },
    async searchNotes(text, ids, limit) {
      calls.push(`searchNotes ${text} ${ids.join(',')}`);
      return NOTES.filter((n) => allowedNote(n, ids) && (has(n.title, text) || has(n.body, text))).slice(0, limit).map(meta);
    },
  };
}
