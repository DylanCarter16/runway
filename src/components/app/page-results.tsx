import Link from 'next/link';
import type { Course } from '@/lib/db/queries';
import type { createClient } from '@/lib/db/server';
import { CourseDot } from './course-mark';
import { MarkedSnippet } from './marked-snippet';

// Pages of uploaded files that match a search (Phase 10): title, page number, the heading it
// sits under, and a snippet with the match marked. Each opens the viewer on that page.

type Supabase = Awaited<ReturnType<typeof createClient>>;

export async function PageResults({ supabase, q, courseId, courses }: { supabase: Supabase; q: string; courseId: string | null; courses: Course[] }) {
  const { data, error } = await supabase.rpc('search_pages', { q, p_course_id: courseId ?? undefined, p_limit: 50 });
  if (error) return <p className="text-sm text-late">Page search failed: {error.message}</p>;
  if (!data?.length) return <p className="text-sm text-muted-foreground">No page in your files matches &quot;{q}&quot;.</p>;
  const courseById = new Map(courses.map((c) => [c.id, c]));
  return (
    <section aria-labelledby="page-hits" className="grid gap-1">
      <h3 id="page-hits" className="text-base font-semibold">
        Pages in files <span className="font-normal text-muted-foreground tabular">({data.length === 50 ? 'first 50' : data.length})</span>
      </h3>
      <ul className="divide-y divide-rule border-y border-rule text-sm">
        {data.map((h) => {
          const course = h.course_id ? courseById.get(h.course_id) : null;
          return (
            <li key={`${h.document_id}-${h.page}`} className="grid gap-0.5 py-2">
              <span className="flex min-w-0 items-center gap-2">
                <CourseDot course={course} />
                <Link href={`/library/${h.document_id}?page=${h.page}`} className="min-h-11 min-w-0 content-center truncate font-semibold text-link underline-offset-2 hover:underline sm:min-h-0">
                  {h.title}, page {h.page}
                </Link>
              </span>
              {(!courseId && course) || h.heading ? <span className="text-muted-foreground">{[courseId ? null : course?.code, h.heading].filter(Boolean).join(', ')}</span> : null}
              <MarkedSnippet text={h.snippet} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
