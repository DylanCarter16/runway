import { notFound } from 'next/navigation';
import { ExternalLinkIcon } from 'lucide-react';
import { courseStyle } from '@/components/app/course-mark';
import { CourseTabs } from '@/components/app/course-tabs';
import { OpenItemButton } from '@/components/app/quick-actions';
import { getAppContext, getCourseBySlug } from '@/lib/db/queries';
import { effectiveDue } from '@/lib/items/runway';
import { formatCountdown, formatListDate } from '@/lib/time';

export default async function CourseLayout({ children, params }: LayoutProps<'/courses/[slug]'>) {
  const { slug } = await params;
  const course = await getCourseBySlug(slug);
  if (!course) notFound();
  const { supabase } = await getAppContext();
  const now = new Date();

  const [pinned, next] = await Promise.all([
    supabase.from('links').select('id, label, url').eq('course_id', course.id).eq('pinned', true).order('sort_order'),
    supabase
      .from('items')
      .select('id, title, due_at, starts_at, time_known, kind')
      .eq('course_id', course.id)
      .eq('state', 'active')
      .in('progress', ['todo', 'started'])
      .neq('kind', 'break')
      .gte('due_at', new Date(now.getTime() - 86_400_000).toISOString())
      .order('due_at')
      .limit(5),
  ]);
  const nextItem = (next.data ?? []).find((i) => (effectiveDue(i) ?? now) > now);

  return (
    <div className="grid gap-4">
      <header data-course="" style={courseStyle(course)} className="relative grid gap-2 pl-4">
        <span aria-hidden className="absolute inset-y-0 left-0 w-1 rounded-full bg-(--course)" />
        <h2 className="text-2xl font-semibold">
          {course.code} <span className="font-normal">{course.title}</span>
        </h2>
        {nextItem ? (
          <p className="text-sm tabular">
            Next:{' '}
            <OpenItemButton id={nextItem.id} className="font-semibold text-tie underline-offset-2 hover:underline">
              {nextItem.title}
            </OpenItemButton>
            , {formatListDate(new Date(nextItem.due_at!))}, {formatCountdown(new Date(nextItem.due_at!), nextItem.time_known, now)}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing coming up.</p>
        )}
        {pinned.data?.length ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {pinned.data.map((l) => (
              <a
                key={l.id}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-rule bg-sheet px-4 text-sm font-semibold hover:border-(--course)"
              >
                {l.label}
                <ExternalLinkIcon className="size-4 text-muted-foreground" aria-hidden />
              </a>
            ))}
          </div>
        ) : null}
      </header>
      <CourseTabs slug={course.slug} />
      <div className="pt-2">{children}</div>
    </div>
  );
}
