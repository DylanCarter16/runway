import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Course } from '@/lib/db/queries';
import type { createClient } from '@/lib/db/server';
import { formatListDate, fromTorontoLocal } from '@/lib/time';
import { selectClass } from '@/lib/ui';
import { cn } from '@/lib/utils';
import { CourseDot } from './course-mark';
import { EmptyState } from './empty-state';

// Notes list (SPEC 4.5 and the course Notes tab): newest lecture first, with a
// course filter and full-text search. A plain GET form, so every view has a URL.

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface NotesFilters {
  courseId: string | null;
  q: string | null;
}

export function readNotesFilters(sp: Record<string, string | string[] | undefined>, courses: Course[]): NotesFilters {
  const course = typeof sp.course === 'string' ? sp.course : '';
  const q = typeof sp.q === 'string' && sp.q.trim() ? sp.q.trim().slice(0, 200) : null;
  return { courseId: course ? (courses.find((c) => c.slug === course || c.id === course)?.id ?? null) : null, q };
}

/** "Lecture notes, Oct 2" when a note has no title yet: the first line of the original, else the date. */
export function noteTitle(n: { title: string | null; original_md: string }): string {
  if (n.title) return n.title;
  const first = n.original_md
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .find(Boolean);
  if (!first) return 'Untitled note';
  return first.length > 80 ? `${first.slice(0, 77)}...` : first;
}

export function lectureDateLabel(lectureOn: string | null): string {
  return lectureOn ? formatListDate(fromTorontoLocal(lectureOn, null)) : 'No date';
}

export async function NotesList({
  supabase,
  courses,
  filters,
  action,
  fixedCourse,
}: {
  supabase: Supabase;
  courses: Course[];
  filters: NotesFilters;
  action: string;
  fixedCourse?: Course;
}) {
  const courseId = fixedCourse?.id ?? filters.courseId;
  let query = supabase
    .from('notes')
    .select('id, course_id, lecture_on, title, topics, summary, cleanup_status, original_md')
    .order('lecture_on', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(300);
  if (courseId) query = query.eq('course_id', courseId);
  if (filters.q) query = query.textSearch('search', filters.q, { type: 'websearch', config: 'english' });
  const { data: notes, error } = await query;
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const filtered = Boolean(filters.q || (!fixedCourse && filters.courseId));
  const newHref = `/notes/new${fixedCourse ? `?course=${fixedCourse.slug}` : ''}`;

  return (
    <div className="grid gap-4">
      <form action={action} method="get" className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end">
        <div className="col-span-2 grid gap-1.5 sm:w-64">
          <label htmlFor="notes-q" className="text-sm font-semibold">
            Search
          </label>
          <Input id="notes-q" name="q" defaultValue={filters.q ?? ''} className="h-11 sm:h-9" placeholder="Words or topics in your notes" />
        </div>
        {fixedCourse ? null : (
          <div className="grid gap-1.5">
            <label htmlFor="notes-course" className="text-sm font-semibold">
              Course
            </label>
            <select id="notes-course" name="course" defaultValue={courses.find((c) => c.id === filters.courseId)?.slug ?? ''} className={selectClass}>
              <option value="">All courses</option>
              {courses.map((c) => (
                <option key={c.id} value={c.slug}>
                  {c.code}
                </option>
              ))}
            </select>
          </div>
        )}
        <Button type="submit" variant="outline" className="h-11 sm:h-9">
          Filter
        </Button>
        <Link href={newHref} className={cn(buttonVariants(), 'h-11 sm:h-9')}>
          Paste notes
        </Link>
        {filtered ? (
          <Link href={action} className="flex h-11 items-center text-sm text-link underline-offset-2 hover:underline sm:h-9">
            Clear filters
          </Link>
        ) : null}
      </form>

      {error ? <p className="text-sm text-late">Search failed: {error.message}</p> : null}
      {notes?.length ? (
        <ul className="divide-y divide-rule border-y border-rule">
          {notes.map((n) => {
            const course = n.course_id ? courseById.get(n.course_id) : undefined;
            const cleaning = course?.ai_allowed && (n.cleanup_status === 'pending' || n.cleanup_status === 'running');
            return (
              <li key={n.id} className="grid gap-1 py-3">
                <span className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                  {fixedCourse ? null : (
                    <span className="inline-flex items-center gap-1.5">
                      <CourseDot course={course} />
                      {course?.code ?? 'No course'}
                    </span>
                  )}
                  <span>{lectureDateLabel(n.lecture_on)}</span>
                  {cleaning ? <span>Cleaning up...</span> : null}
                </span>
                <Link href={`/notes/${n.id}`} className="font-semibold text-link underline-offset-2 hover:underline">
                  {noteTitle(n)}
                </Link>
                {n.summary ? <span className="text-sm">{n.summary}</span> : null}
                {n.topics.length ? (
                  <span className="flex flex-wrap gap-1.5">
                    {n.topics.map((t) => (
                      <span key={t} className="rounded-md border border-rule px-1.5 text-xs text-muted-foreground">
                        {t}
                      </span>
                    ))}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : filtered ? (
        <p className="text-sm text-muted-foreground">No notes match.</p>
      ) : (
        <EmptyState
          title={fixedCourse ? `No notes for ${fixedCourse.code} yet.` : 'No notes yet.'}
          action={
            <Link href={newHref} className={cn(buttonVariants(), 'h-11 sm:h-9')}>
              Paste notes
            </Link>
          }
        >
          Paste today&apos;s lecture notes.
          {fixedCourse && !fixedCourse.ai_allowed ? ` They are stored exactly as written; ${fixedCourse.code} bans generative AI, so no cleaned copy is made.` : ''}
        </EmptyState>
      )}
    </div>
  );
}
