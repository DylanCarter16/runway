import { z } from 'zod';
import type { ItemKind } from '@/config/term-f26';
import { KIND_LABEL, SOURCE_LABEL } from '@/lib/items/labels';
import { expandQuery } from '@/lib/search/aliases';
import { addDaysToDate, formatWhen, fromTorontoLocal, toTorontoDate, toTorontoTime } from '@/lib/time';

// Read-only MCP server over items and notes (Phase 8), so a Claude chat can ask
// Runway what's due and what the notes say. Stateless Streamable HTTP: every POST
// carries one JSON-RPC message (or a batch) and gets a plain JSON answer; there are
// no sessions and no server-sent events.
//
// The course AI switch still applies, because answers go straight into a Claude
// conversation: notes are listed and read only for courses with AI on, and an
// item's free-text description is left out unless its course has AI on. Dates,
// titles, rooms, and weights are schedule facts and come through for every course
// (the ICS feed and Google Calendar already carry them).

export const MCP_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const MCP_SERVER_INFO = { name: 'runway', title: 'Runway', version: '1.0.0' };

export interface McpCourse {
  id: string;
  code: string;
  slug: string;
  title: string;
  ai_allowed: boolean;
  site_url: string | null;
  outline_url: string | null;
  late_policy: string | null;
  grading_scheme: unknown;
}

export interface McpItem {
  id: string;
  course_id: string | null;
  kind: string;
  title: string;
  description: string | null;
  starts_at: string | null;
  due_at: string | null;
  ends_at: string | null;
  all_day: boolean;
  time_known: boolean;
  location: string | null;
  seat: string | null;
  weight_percent: number | null;
  progress: string;
  flags: string[];
  source: string;
  source_url: string | null;
}

export interface McpNote {
  id: string;
  course_id: string | null;
  lecture_on: string | null;
  title: string | null;
  topics: string[];
  summary: string | null;
  open_questions: string[];
}

export interface McpNoteBody extends McpNote {
  /** Dylan's edit, else the cleaned copy, else the original. */
  body: string;
}

/**
 * What the tools read. Every method is scoped to one user by the caller. Note
 * methods take the course ids they may return, and the tools check the result again.
 */
export interface McpData {
  courses(): Promise<McpCourse[]>;
  /** Active items whose due or start time falls in [from, to). */
  itemsBetween(from: Date, to: Date, courseId: string | null): Promise<McpItem[]>;
  item(id: string): Promise<McpItem | null>;
  searchItems(text: string, courseId: string | null, limit: number): Promise<McpItem[]>;
  notes(courseIds: string[], limit: number): Promise<McpNote[]>;
  note(id: string): Promise<McpNoteBody | null>;
  searchNotes(text: string, courseIds: string[], limit: number): Promise<McpNote[]>;
}

export interface McpContext {
  data: McpData;
  appUrl: string;
  now: Date;
}

// ---------------------------------------------------------------- tools

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');
const COURSE = z.string().max(20).describe('Course code or slug, like "STAT 230" or "cs251". Leave out for every course.');

const listCoursesInput = z.object({}).strict();
const listDeadlinesInput = z
  .object({
    course: COURSE.optional(),
    from: DATE.optional().describe('First day to include (America/Toronto). Defaults to today.'),
    days: z.number().int().min(1).max(150).optional().describe('How many days to include. Defaults to 14.'),
    include_done: z.boolean().optional().describe('Include submitted and graded items. Defaults to false.'),
  })
  .strict();
const searchInput = z
  .object({
    query: z.string().trim().min(1).max(200).describe('Words to find, like "a3", "midterm room", or "cs251 exam". A course code in the query filters to that course.'),
    course: COURSE.optional(),
  })
  .strict();
const idInput = z.object({ id: z.uuid() }).strict();
const listNotesInput = z
  .object({
    course: COURSE.optional(),
    limit: z.number().int().min(1).max(50).optional().describe('Newest first. Defaults to 20.'),
  })
  .strict();

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

class ToolError extends Error {}

interface Tool {
  name: string;
  title: string;
  description: string;
  input: z.ZodType;
  run(args: never, ctx: McpContext): Promise<unknown>;
}

function inputSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' }) as Record<string, unknown>;
  void _drop;
  return rest;
}

function findCourse(courses: McpCourse[], wanted: string | undefined): McpCourse | null {
  if (!wanted) return null;
  const key = wanted.toLowerCase().replace(/[\s-]/g, '');
  const course = courses.find((c) => c.slug === key || c.code.toLowerCase().replace(/\s/g, '') === key);
  if (!course) throw new ToolError(`No course "${wanted}". Courses: ${courses.map((c) => c.code).join(', ')}.`);
  return course;
}

function when(iso: string | null, timeKnown: boolean) {
  if (!iso) return null;
  const d = new Date(iso);
  return { text: formatWhen(d, timeKnown), date: toTorontoDate(d), time: timeKnown ? toTorontoTime(d) : null };
}

function itemOut(item: McpItem, courses: McpCourse[], appUrl: string) {
  const course = courses.find((c) => c.id === item.course_id) ?? null;
  const main = item.due_at ?? item.starts_at;
  return {
    id: item.id,
    course: course?.code ?? null,
    kind: KIND_LABEL[item.kind as ItemKind] ?? item.kind,
    title: item.title,
    [item.due_at ? 'due' : 'starts']: when(main, item.time_known && !item.all_day),
    ends: item.ends_at ? when(item.ends_at, true) : undefined,
    location: item.location ?? undefined,
    seat: item.seat ?? undefined,
    weight_percent: item.weight_percent ?? undefined,
    progress: item.progress,
    flags: item.flags.length ? item.flags : undefined,
    description: course?.ai_allowed && item.description ? item.description : undefined,
    source: SOURCE_LABEL[item.source] ?? item.source,
    source_url: item.source_url ?? undefined,
    runway_url: `${appUrl}/items/${item.id}`,
  };
}

function noteOut(note: McpNote, courses: McpCourse[], appUrl: string) {
  return {
    id: note.id,
    course: courses.find((c) => c.id === note.course_id)?.code ?? null,
    lecture_on: note.lecture_on,
    title: note.title ?? 'Untitled note',
    topics: note.topics.length ? note.topics : undefined,
    summary: note.summary ?? undefined,
    open_questions: note.open_questions.length ? note.open_questions : undefined,
    runway_url: `${appUrl}/notes/${note.id}`,
  };
}

/** Ids of the courses whose notes may be read, narrowed to one course when asked. */
function noteCourseIds(courses: McpCourse[], course: McpCourse | null): string[] {
  if (course && !course.ai_allowed) {
    throw new ToolError(`${course.code} has AI turned off, so its notes are not shared with Claude.`);
  }
  return (course ? [course] : courses.filter((c) => c.ai_allowed)).map((c) => c.id);
}

function aiOffNote(courses: McpCourse[]): string {
  const off = courses.filter((c) => !c.ai_allowed).map((c) => c.code);
  return off.length ? `Notes from ${off.join(', ')} are not shared because those courses have AI turned off.` : '';
}

function byDate(a: McpItem, b: McpItem): number {
  return (a.due_at ?? a.starts_at ?? '').localeCompare(b.due_at ?? b.starts_at ?? '');
}

const TOOLS: Tool[] = [
  {
    name: 'list_courses',
    title: 'List courses',
    description: "Dylan's courses this term: code, title, whether AI is allowed, course site, outline, late policy, and grading scheme.",
    input: listCoursesInput,
    async run(_args: z.infer<typeof listCoursesInput>, ctx) {
      const courses = await ctx.data.courses();
      return courses.map((c) => ({
        code: c.code,
        title: c.title,
        ai_allowed: c.ai_allowed,
        site_url: c.site_url ?? undefined,
        outline_url: c.outline_url ?? undefined,
        late_policy: c.late_policy ?? undefined,
        grading_scheme: c.grading_scheme,
        runway_url: `${ctx.appUrl}/courses/${c.slug}`,
      }));
    },
  },
  {
    name: 'list_deadlines',
    title: 'List deadlines and exams',
    description:
      'Deadlines, exams, quizzes, and other dated items in a date range, soonest first. Times are America/Toronto. Defaults to the next 14 days and leaves out submitted work.',
    input: listDeadlinesInput,
    async run(args: z.infer<typeof listDeadlinesInput>, ctx) {
      const courses = await ctx.data.courses();
      const course = findCourse(courses, args.course);
      const fromDate = args.from ?? toTorontoDate(ctx.now);
      const days = args.days ?? 14;
      const toDate = addDaysToDate(fromDate, days);
      const rows = await ctx.data.itemsBetween(fromTorontoLocal(fromDate, null), fromTorontoLocal(toDate, null), course?.id ?? null);
      const items = rows
        .filter((i) => !course || i.course_id === course.id)
        .filter((i) => args.include_done || (i.progress !== 'submitted' && i.progress !== 'graded'))
        .sort(byDate);
      return {
        range: { from: fromDate, to: addDaysToDate(toDate, -1), time_zone: 'America/Toronto' },
        count: items.length,
        items: items.map((i) => itemOut(i, courses, ctx.appUrl)),
      };
    },
  },
  {
    name: 'search',
    title: 'Search Runway',
    description:
      'Finds deadlines, exams, and lecture notes by words in their title, description, room, or note text. Returns items and notes (notes only from courses with AI allowed).',
    input: searchInput,
    async run(args: z.infer<typeof searchInput>, ctx) {
      const courses = await ctx.data.courses();
      const named = findCourse(courses, args.course);
      const expanded = expandQuery(args.query, courses);
      const course = named ?? (expanded.course ? (courses.find((c) => c.id === expanded.course?.id) ?? null) : null);
      const text = expanded.text.trim();
      const items = (await ctx.data.searchItems(text, course?.id ?? null, 25))
        .filter((i) => !course || i.course_id === course.id)
        .filter((i) => !expanded.kind || i.kind === expanded.kind);
      const allowed = course && !course.ai_allowed ? [] : noteCourseIds(courses, course);
      const notes = text && allowed.length ? await ctx.data.searchNotes(text, allowed, 10) : [];
      return {
        items: items.map((i) => itemOut(i, courses, ctx.appUrl)),
        notes: notes.filter((n) => n.course_id && allowed.includes(n.course_id)).map((n) => noteOut(n, courses, ctx.appUrl)),
        note: aiOffNote(courses) || undefined,
      };
    },
  },
  {
    name: 'get_item',
    title: 'Get a deadline or exam',
    description: 'One item by id (from list_deadlines or search), with its room, seat, weight, progress, and where it came from.',
    input: idInput,
    async run(args: z.infer<typeof idInput>, ctx) {
      const [courses, item] = await Promise.all([ctx.data.courses(), ctx.data.item(args.id)]);
      if (!item) throw new ToolError('No item with that id.');
      return itemOut(item, courses, ctx.appUrl);
    },
  },
  {
    name: 'list_notes',
    title: 'List lecture notes',
    description: 'Lecture notes, newest first, with title, lecture date, topics, summary, and open questions. Only courses with AI allowed.',
    input: listNotesInput,
    async run(args: z.infer<typeof listNotesInput>, ctx) {
      const courses = await ctx.data.courses();
      const allowed = noteCourseIds(courses, findCourse(courses, args.course));
      const notes = allowed.length ? await ctx.data.notes(allowed, args.limit ?? 20) : [];
      return {
        notes: notes.filter((n) => n.course_id && allowed.includes(n.course_id)).map((n) => noteOut(n, courses, ctx.appUrl)),
        note: aiOffNote(courses) || undefined,
      };
    },
  },
  {
    name: 'get_note',
    title: 'Read a lecture note',
    description: "The full text of one lecture note by id, as Markdown (Dylan's edited copy if there is one, else the cleaned copy, else the original).",
    input: idInput,
    async run(args: z.infer<typeof idInput>, ctx) {
      const [courses, note] = await Promise.all([ctx.data.courses(), ctx.data.note(args.id)]);
      if (!note) throw new ToolError('No note with that id.');
      const course = courses.find((c) => c.id === note.course_id);
      if (!course) throw new ToolError('This note has no course, so it is not shared with Claude.');
      if (!course.ai_allowed) throw new ToolError(`${course.code} has AI turned off, so its notes are not shared with Claude.`);
      return { ...noteOut(note, courses, ctx.appUrl), markdown: note.body };
    },
  },
];

export const MCP_TOOL_NAMES = TOOLS.map((t) => t.name);

function toolList() {
  return TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: inputSchema(t.input),
    annotations: { title: t.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }));
}

async function callTool(name: string, rawArgs: unknown, ctx: McpContext): Promise<ToolResult | null> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return null;
  const parsed = tool.input.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { content: [{ type: 'text', text: `Bad arguments: ${issue?.path.join('.') || 'input'}: ${issue?.message}` }], isError: true };
  }
  try {
    const result = await tool.run(parsed.data as never, ctx);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    if (e instanceof ToolError) return { content: [{ type: 'text', text: e.message }], isError: true };
    throw e;
  }
}

// ---------------------------------------------------------------- JSON-RPC

const INSTRUCTIONS =
  "Runway is Dylan's course tracker for Waterloo Fall 2026. Use list_deadlines for what's due, search to find an item or note by name, and get_note to read a note. Times are America/Toronto. Everything is read-only; changes happen in the Runway app (runway_url).";

const messageSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]).nullish(),
  method: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});

type RpcId = string | number | null;
type RpcResponse = { jsonrpc: '2.0'; id: RpcId; result: unknown } | { jsonrpc: '2.0'; id: RpcId; error: { code: number; message: string } };

const rpcError = (id: RpcId, code: number, message: string): RpcResponse => ({ jsonrpc: '2.0', id, error: { code, message } });

async function handleMessage(raw: unknown, ctx: McpContext): Promise<RpcResponse | null> {
  const parsed = messageSchema.safeParse(raw);
  if (!parsed.success) return rpcError(null, -32600, 'Invalid request');
  const { id, method, params } = parsed.data;
  // Notifications (no id) and responses to server requests get no answer.
  if (id === undefined || id === null || !method) return null;

  switch (method) {
    case 'initialize': {
      const asked = typeof params?.protocolVersion === 'string' ? params.protocolVersion : '';
      const version = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0];
      return {
        jsonrpc: '2.0',
        id,
        result: { protocolVersion: version, capabilities: { tools: { listChanged: false } }, serverInfo: MCP_SERVER_INFO, instructions: INSTRUCTIONS },
      };
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: toolList() } };
    case 'tools/call': {
      const name = typeof params?.name === 'string' ? params.name : '';
      const result = await callTool(name, params?.arguments, ctx);
      return result ? { jsonrpc: '2.0', id, result } : rpcError(id, -32602, `Unknown tool: ${name}`);
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

export interface McpHttpAnswer {
  status: number;
  body: unknown;
}

/**
 * Answers one POSTed body. 202 with no body when it held only notifications,
 * 200 with the response (or array of responses) otherwise, 400 for bad JSON.
 */
export async function handleMcpPost(text: string, ctx: McpContext): Promise<McpHttpAnswer> {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { status: 400, body: rpcError(null, -32700, 'Parse error') };
  }
  if (Array.isArray(body)) {
    if (body.length === 0) return { status: 400, body: rpcError(null, -32600, 'Invalid request') };
    const answers = (await Promise.all(body.map((m) => handleMessage(m, ctx)))).filter((a): a is RpcResponse => a !== null);
    return answers.length ? { status: 200, body: answers } : { status: 202, body: null };
  }
  const answer = await handleMessage(body, ctx);
  return answer ? { status: 200, body: answer } : { status: 202, body: null };
}
