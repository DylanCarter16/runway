import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buttonVariants } from '@/components/ui/button';
import { COURSE_TABS } from '@/components/app/course-tabs';
import { EmptyState } from '@/components/app/empty-state';
import { LinksManager, type LinkRow } from '@/components/app/links-manager';
import { getAppContext, getCourseBySlug } from '@/lib/db/queries';
import { describeChange } from '@/lib/items/changes';
import { formatAgo, formatListDate } from '@/lib/time';
import { cn } from '@/lib/utils';
import { CourseDeadlines } from './deadlines';
import { CourseOverview } from './overview';

export async function generateMetadata({ params }: PageProps<'/courses/[slug]/[tab]'>) {
  const { slug, tab } = await params;
  const course = await getCourseBySlug(slug);
  const label = COURSE_TABS.find(([t]) => t === tab)?.[1] ?? '';
  return { title: course ? `${course.code} ${label.toLowerCase()}` : 'Course' };
}

export default async function CourseTabPage({ params, searchParams }: PageProps<'/courses/[slug]/[tab]'>) {
  const { slug, tab } = await params;
  const sp = await searchParams;
  const course = await getCourseBySlug(slug);
  if (!course || !COURSE_TABS.some(([t]) => t === tab)) notFound();
  const { supabase } = await getAppContext();
  const now = new Date();

  switch (tab) {
    case 'overview':
      return <CourseOverview course={course} />;

    case 'deadlines':
      return (
        <CourseDeadlines
          course={course}
          kind={typeof sp.kind === 'string' ? sp.kind : null}
          progress={typeof sp.progress === 'string' ? sp.progress : null}
        />
      );

    case 'resources': {
      const { data } = await supabase
        .from('links')
        .select('id, course_id, label, url, category, where_to_find, pinned, sort_order')
        .eq('course_id', course.id)
        .order('sort_order');
      return <LinksManager courseId={course.id} links={(data ?? []) as LinkRow[]} />;
    }

    case 'notes':
      return (
        <EmptyState
          title={`No notes for ${course.code} yet.`}
          action={
            <Link href={`/notes/new?course=${course.slug}`} className={cn(buttonVariants(), 'h-11 sm:h-9')}>
              Paste notes
            </Link>
          }
        >
          Paste today&apos;s lecture notes.
          {course.ai_allowed ? '' : ` They are stored exactly as written; ${course.code} bans generative AI, so no cleaned copy is made.`}
        </EmptyState>
      );

    case 'ask':
      if (!course.ai_allowed) {
        return (
          <section className="grid max-w-prose gap-2">
            <h3 className="text-base font-semibold">Ask is off for {course.code}</h3>
            <p className="text-sm text-muted-foreground">{course.ai_policy}</p>
            <p className="text-sm">Runway never sends this course&apos;s notes, pastes, or emails to Claude.</p>
          </section>
        );
      }
      return (
        <EmptyState title={`No questions about ${course.code} yet.`}>
          Ask answers from your {course.code} notes once some are saved. The outline allows AI as a study aid: {course.ai_policy}
        </EmptyState>
      );

    case 'updates': {
      const { data: items } = await supabase.from('items').select('id, title').eq('course_id', course.id);
      const titles = new Map((items ?? []).map((i) => [i.id, i.title]));
      const { data: changes } = titles.size
        ? await supabase
            .from('item_changes')
            .select('id, item_id, field, old_value, new_value, source, detected_at')
            .in('item_id', [...titles.keys()])
            .order('detected_at', { ascending: false })
            .limit(100)
        : { data: [] };
      if (!changes?.length) {
        return (
          <EmptyState
            title={`Nothing has changed in ${course.code} yet.`}
            action={
              <Link href="/inbox" className={cn(buttonVariants({ variant: 'outline' }), 'h-11 sm:h-9')}>
                Paste an announcement
              </Link>
            }
          >
            Date changes, page edits, and pasted announcements show up here.
          </EmptyState>
        );
      }
      return (
        <ul className="divide-y divide-rule text-sm">
          {changes.map((c) => (
            <li key={c.id} className="py-2">
              {describeChange(titles.get(c.item_id) ?? 'An item', c)}.{' '}
              <span className="text-muted-foreground">{formatAgo(new Date(c.detected_at), now)}</span>
            </li>
          ))}
        </ul>
      );
    }

    case 'grades':
      return (
        <EmptyState
          title={`No marks for ${course.code} yet.`}
          action={
            <Link href="/inbox" className={cn(buttonVariants({ variant: 'outline' }), 'h-11 sm:h-9')}>
              Paste grades
            </Link>
          }
        >
          Paste a grades page from LEARN or Crowdmark to track your running average.
        </EmptyState>
      );

    case 'library': {
      const { data: docs } = await supabase
        .from('documents')
        .select('id, title, kind, captured_at')
        .eq('course_id', course.id)
        .order('captured_at', { ascending: false })
        .limit(200);
      if (!docs?.length) {
        return (
          <EmptyState
            title={`No documents for ${course.code} yet.`}
            action={
              <Link href="/inbox" className={cn(buttonVariants({ variant: 'outline' }), 'h-11 sm:h-9')}>
                Paste something
              </Link>
            }
          >
            Everything you paste for this course is stored here word for word.
          </EmptyState>
        );
      }
      return (
        <ul className="divide-y divide-rule text-sm">
          {docs.map((d) => (
            <li key={d.id} className="py-2">
              <Link href={`/library/${d.id}`} className="font-semibold text-tie underline-offset-2 hover:underline">
                {d.title}
              </Link>
              <span className="block text-muted-foreground">
                {d.kind.replace(/_/g, ' ')}, {formatListDate(new Date(d.captured_at))}
              </span>
            </li>
          ))}
        </ul>
      );
    }
  }
  notFound();
}
