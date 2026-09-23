import { z } from 'zod';

// What a question is about (SPEC 4.6). Stored on ask_threads.scope; the DB
// default is {"type": "all"}. "all" means every course with AI on.

export const askScopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('all') }),
  z.object({ type: z.literal('course'), courseId: z.uuid() }),
  z.object({ type: z.literal('note'), noteId: z.uuid() }),
  z.object({ type: z.literal('item'), itemId: z.uuid() }),
]);

export type AskScope = z.infer<typeof askScopeSchema>;

export const ALL_SCOPE: AskScope = { type: 'all' };

/** Reads a stored scope, falling back to Everything for anything unexpected. */
export function readScope(value: unknown): AskScope {
  const parsed = askScopeSchema.safeParse(value);
  return parsed.success ? parsed.data : ALL_SCOPE;
}

/** Graded work: Ask shows the course's AI policy banner for these (SPEC 4.6). */
export const GRADED_KINDS = new Set(['assignment', 'quiz', 'project', 'lab']);

export function scopeKey(scope: AskScope): string {
  switch (scope.type) {
    case 'all':
      return 'all';
    case 'course':
      return `course:${scope.courseId}`;
    case 'note':
      return `note:${scope.noteId}`;
    case 'item':
      return `item:${scope.itemId}`;
  }
}

export function parseScopeKey(key: string | null | undefined): AskScope {
  if (!key || key === 'all') return ALL_SCOPE;
  const [type, id] = key.split(':');
  return readScope(type === 'course' ? { type, courseId: id } : type === 'note' ? { type, noteId: id } : { type, itemId: id });
}

/** What the scope picker offers: only courses with AI on, and their notes and items. */
export interface ScopeOptions {
  courses: { id: string; code: string; slug: string; ai_policy: string | null; outline_url: string | null }[];
  notes: { id: string; title: string; courseId: string; lectureOn: string | null }[];
  items: { id: string; title: string; kind: string; courseId: string; date: string | null }[];
}

export function scopeLabel(scope: AskScope, options: ScopeOptions): string {
  const code = (id: string) => options.courses.find((c) => c.id === id)?.code ?? 'Course';
  switch (scope.type) {
    case 'all':
      return 'Everything';
    case 'course':
      return code(scope.courseId);
    case 'note': {
      const n = options.notes.find((x) => x.id === scope.noteId);
      return n ? `${code(n.courseId)} note: ${n.title}` : 'A note';
    }
    case 'item': {
      const i = options.items.find((x) => x.id === scope.itemId);
      return i ? `${code(i.courseId)} ${i.title}` : 'An item';
    }
  }
}

/** The AI policy banner for graded work (SPEC 4.6), or null. */
export function scopeBanner(scope: AskScope, options: ScopeOptions): { courseCode: string; policy: string | null; outlineUrl: string | null } | null {
  if (scope.type !== 'item') return null;
  const item = options.items.find((i) => i.id === scope.itemId);
  if (!item || !GRADED_KINDS.has(item.kind)) return null;
  const course = options.courses.find((c) => c.id === item.courseId);
  return course ? { courseCode: course.code, policy: course.ai_policy, outlineUrl: course.outline_url } : null;
}
