import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { courseStyle } from '@/components/app/course-mark';
import { EmptyState } from '@/components/app/empty-state';
import { LinksManager, type LinkRow } from '@/components/app/links-manager';
import { getAppContext } from '@/lib/db/queries';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Courses' };

export default async function CoursesPage() {
  const { supabase, courses, term } = await getAppContext();
  if (!courses.length) {
    return (
      <EmptyState
        title="No courses yet"
        action={
          <Link href="/settings/term" className={cn(buttonVariants(), 'h-11 sm:h-9')}>
            Open Settings, Term
          </Link>
        }
      >
        Load the Fall 2026 setup to add your four courses.
      </EmptyState>
    );
  }
  const { data: links } = await supabase
    .from('links')
    .select('id, course_id, label, url, category, where_to_find, pinned, sort_order')
    .is('course_id', null)
    .order('sort_order');

  return (
    <div className="grid gap-8">
      <h2 className="text-2xl font-semibold">{term?.name ?? 'Courses'}</h2>
      <ul className="divide-y divide-rule border-y border-rule">
        {courses.map((c) => (
          <li key={c.id} data-course="" style={courseStyle(c)} className="relative">
            <span aria-hidden className="absolute inset-y-2 left-0 w-1 rounded-full bg-(--course)" />
            <Link href={`/courses/${c.slug}/overview`} className="grid min-h-14 content-center gap-0.5 py-3 pl-4 hover:bg-muted">
              <span className="font-semibold">{c.code}</span>
              <span className="text-sm text-muted-foreground">
                {c.title}, AI {c.ai_allowed ? 'on' : 'off'}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <section className="grid gap-3">
        <h3 className="text-[21px] font-semibold">Links for every course</h3>
        <LinksManager courseId={null} links={(links ?? []) as LinkRow[]} />
      </section>
    </div>
  );
}
