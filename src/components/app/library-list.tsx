import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Course } from '@/lib/db/queries';
import type { createClient } from '@/lib/db/server';
import { DOCUMENT_KIND_LABEL, documentKindLabel } from '@/lib/inbox/kinds';
import { fromTorontoLocal, addDaysToDate, formatListDate } from '@/lib/time';
import { selectClass } from '@/lib/ui';
import { EmptyState } from './empty-state';

// Library list with filters for kind, course, date, and full-text search
// (SPEC 4.8). A plain GET form, so every filtered view has its own URL.

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface LibraryFilters {
  kind: string | null;
  courseId: string | null;
  q: string | null;
  from: string | null;
  to: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function readLibraryFilters(sp: Record<string, string | string[] | undefined>, courses: Course[]): LibraryFilters {
  const str = (k: string) => (typeof sp[k] === 'string' && sp[k] ? (sp[k] as string) : null);
  const course = str('course');
  return {
    kind: str('kind') && DOCUMENT_KIND_LABEL[str('kind')!] ? str('kind') : null,
    courseId: course ? (courses.find((c) => c.slug === course || c.id === course)?.id ?? null) : null,
    q: str('q')?.slice(0, 200) ?? null,
    from: str('from') && DATE_RE.test(str('from')!) ? str('from') : null,
    to: str('to') && DATE_RE.test(str('to')!) ? str('to') : null,
  };
}

export async function LibraryList({
  supabase,
  courses,
  filters,
  action,
  fixedCourse,
}: {
  supabase: Supabase;
  courses: Course[];
  filters: LibraryFilters;
  action: string;
  /** On a course's Library tab the course filter is fixed. */
  fixedCourse?: Course;
}) {
  const courseId = fixedCourse?.id ?? filters.courseId;
  let query = supabase.from('documents').select('id, title, kind, course_id, captured_at, meta').order('captured_at', { ascending: false }).limit(200);
  if (courseId) query = query.eq('course_id', courseId);
  if (filters.kind) query = query.eq('kind', filters.kind);
  if (filters.q) query = query.textSearch('search', filters.q, { type: 'websearch', config: 'english' });
  if (filters.from) query = query.gte('captured_at', fromTorontoLocal(filters.from, null).toISOString());
  if (filters.to) query = query.lt('captured_at', fromTorontoLocal(addDaysToDate(filters.to, 1), null).toISOString());
  const { data: docs, error } = await query;
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const filtered = Boolean(filters.kind || filters.q || filters.from || filters.to || (!fixedCourse && filters.courseId));

  return (
    <div className="grid gap-4">
      <form action={action} method="get" className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end">
        <div className="col-span-2 grid gap-1.5 sm:w-64">
          <label htmlFor="lib-q" className="text-sm font-semibold">
            Search
          </label>
          <Input id="lib-q" name="q" defaultValue={filters.q ?? ''} className="h-11 sm:h-9" placeholder="Words in the document" />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="lib-kind" className="text-sm font-semibold">
            Kind
          </label>
          <select id="lib-kind" name="kind" defaultValue={filters.kind ?? ''} className={selectClass}>
            <option value="">All kinds</option>
            {Object.entries(DOCUMENT_KIND_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {fixedCourse ? null : (
          <div className="grid gap-1.5">
            <label htmlFor="lib-course" className="text-sm font-semibold">
              Course
            </label>
            <select id="lib-course" name="course" defaultValue={courses.find((c) => c.id === filters.courseId)?.slug ?? ''} className={selectClass}>
              <option value="">All courses</option>
              {courses.map((c) => (
                <option key={c.id} value={c.slug}>
                  {c.code}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="grid gap-1.5">
          <label htmlFor="lib-from" className="text-sm font-semibold">
            From
          </label>
          <Input id="lib-from" name="from" type="date" defaultValue={filters.from ?? ''} className="h-11 sm:h-9" />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="lib-to" className="text-sm font-semibold">
            To
          </label>
          <Input id="lib-to" name="to" type="date" defaultValue={filters.to ?? ''} className="h-11 sm:h-9" />
        </div>
        <Button type="submit" variant="outline" className="h-11 sm:h-9">
          Filter
        </Button>
        {filtered ? (
          <Link href={action} className="flex h-11 items-center text-sm text-link underline-offset-2 hover:underline sm:h-9">
            Clear filters
          </Link>
        ) : null}
      </form>

      {error ? <p className="text-sm text-late">Search failed: {error.message}</p> : null}
      {docs?.length ? (
        <ul className="divide-y divide-rule border-y border-rule text-sm">
          {docs.map((d) => {
            const meta = (d.meta ?? {}) as { summary?: string | null };
            return (
              <li key={d.id} className="py-2">
                <Link href={`/library/${d.id}`} className="font-semibold text-link underline-offset-2 hover:underline">
                  {d.title}
                </Link>
                <span className="block text-muted-foreground">
                  {[fixedCourse ? null : d.course_id ? courseById.get(d.course_id)?.code : null, documentKindLabel(d.kind), formatListDate(new Date(d.captured_at))]
                    .filter(Boolean)
                    .join(', ')}
                </span>
                {meta.summary ? <span className="block">{meta.summary}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : filtered ? (
        <p className="text-sm text-muted-foreground">No documents match these filters.</p>
      ) : (
        <EmptyState
          title={fixedCourse ? `No documents for ${fixedCourse.code} yet.` : 'Nothing stored yet.'}
          action={
            <Link href="/inbox" className="text-sm text-link underline underline-offset-2">
              Paste something
            </Link>
          }
        >
          Everything you paste, and every page snapshot, is kept here word for word.
        </EmptyState>
      )}
    </div>
  );
}
