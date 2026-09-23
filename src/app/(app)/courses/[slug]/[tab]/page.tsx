import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/app/empty-state';
import { LinksManager, type LinkRow } from '@/components/app/links-manager';
import { getAppContext, getCourseBySlug } from '@/lib/db/queries';
import { describeChange } from '@/lib/items/changes';
import { formatAgo, formatListDate } from '@/lib/time';
import { COURSE_TABS } from '@/lib/ui';
import { cn } from '@/lib/utils';
import { CourseDeadlines } from './deadlines';
import { CourseOverview } from './overview';

export async function generateMetadata({ params }: PageProps<'/courses/[slug]/[tab]'>) {
  const { slug, tab } = await params;
  const course = await getCourseBySlug(slug);
  const label = COURSE_TABS.find(([t]) => t === tab)?.[1] ?? '';
  return { title: course ? `${course.code} ${label.toLowerCase()}` : 'Course' };
}

type UpdateEntry =
  | { type: 'change'; at: string; change: { id: string; item_id: string; field: string; old_value: string | null; new_value: string | null; source: string | null } }
  | { type: 'page'; at: string; doc: { id: string; title: string; source_url: string | null; meta: unknown } };

const DIFF_LINES = 12;

/** A watched page that changed, with its raw added and removed lines. */
function PageUpdate({ doc, now, at }: { doc: { id: string; title: string; source_url: string | null; meta: unknown }; now: Date; at: string }) {
  const meta = (doc.meta ?? {}) as { label?: string; diff?: { added: string[]; removed: string[] } | null };
  const label = meta.label ?? doc.title;
  const diff = meta.diff;
  const lines = diff ? [...diff.removed.map((t) => ['-', t] as const), ...diff.added.map((t) => ['+', t] as const)] : [];
  return (
    <li className="grid gap-1 py-2">
      <span>
        {diff ? `${label} page changed.` : `Started watching the ${label} page.`}{' '}
        <Link href={`/library/${doc.id}`} className="text-tie underline-offset-2 hover:underline">
          Saved copy
        </Link>
        {doc.source_url ? (
          <>
            {' · '}
            <a href={doc.source_url} target="_blank" rel="noopener noreferrer" className="text-tie underline-offset-2 hover:underline">
              Open page
            </a>
          </>
        ) : null}{' '}
        <span className="text-muted-foreground">{formatAgo(new Date(at), now)}</span>
      </span>
      {lines.length ? (
        <ul className="grid gap-0.5 rounded-md border border-rule bg-sheet p-2 font-mono text-[13px]">
          {lines.slice(0, DIFF_LINES).map(([sign, text], i) => (
            <li key={i} className={sign === '+' ? 'text-foreground' : 'text-muted-foreground line-through'}>
              <span aria-hidden="true">{sign} </span>
              <span className="sr-only">{sign === '+' ? 'Added: ' : 'Removed: '}</span>
              {text}
            </li>
          ))}
          {lines.length > DIFF_LINES ? <li className="text-muted-foreground">and {lines.length - DIFF_LINES} more lines</li> : null}
        </ul>
      ) : null}
    </li>
  );
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
      const [{ data: changes }, { data: snapshots }] = await Promise.all([
        titles.size
          ? supabase
              .from('item_changes')
              .select('id, item_id, field, old_value, new_value, source, detected_at')
              .in('item_id', [...titles.keys()])
              .order('detected_at', { ascending: false })
              .limit(100)
          : Promise.resolve({ data: [] }),
        supabase
          .from('documents')
          .select('id, title, source_url, captured_at, meta')
          .eq('course_id', course.id)
          .eq('kind', 'page_snapshot')
          .order('captured_at', { ascending: false })
          .limit(50),
      ]);
      const feed: UpdateEntry[] = [
        ...(changes ?? []).map((c) => ({ type: 'change' as const, at: c.detected_at, change: c })),
        ...(snapshots ?? []).map((d) => ({ type: 'page' as const, at: d.captured_at, doc: d })),
      ].sort((a, b) => b.at.localeCompare(a.at));
      if (!feed.length) {
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
          {feed.map((e) =>
            e.type === 'change' ? (
              <li key={e.change.id} className="py-2">
                <Link href={`/items/${e.change.item_id}`} className="underline-offset-2 hover:underline">
                  {describeChange(titles.get(e.change.item_id) ?? 'An item', e.change)}.
                </Link>{' '}
                <span className="text-muted-foreground">{formatAgo(new Date(e.at), now)}</span>
              </li>
            ) : (
              <PageUpdate key={e.doc.id} doc={e.doc} at={e.at} now={now} />
            ),
          )}
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
