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
