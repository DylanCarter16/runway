import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buttonVariants } from '@/components/ui/button';
import { AskThreads } from '@/components/app/ask-threads';
import { AskView } from '@/components/app/ask-view';
import { EmptyState } from '@/components/app/empty-state';
import { LibraryList, readLibraryFilters } from '@/components/app/library-list';
import { LinksManager, type LinkRow } from '@/components/app/links-manager';
import { NotesList, readNotesFilters } from '@/components/app/notes-list';
import { DiffLines, type PageDiff } from '@/components/app/page-diff';
import { getAppContext, getCourseBySlug } from '@/lib/db/queries';
import { documentKindLabel } from '@/lib/inbox/kinds';
import { describeChange } from '@/lib/items/changes';
import { formatAgo } from '@/lib/time';
import { COURSE_TABS } from '@/lib/ui';
import { cn } from '@/lib/utils';
import { CourseDeadlines } from './deadlines';
import { CourseGrades } from './grades';
import { CourseOverview } from './overview';
import { askPageData } from '../../../ask/data';

export async function generateMetadata({ params }: PageProps<'/courses/[slug]/[tab]'>) {
  const { slug, tab } = await params;
  const course = await getCourseBySlug(slug);
  const label = COURSE_TABS.find(([t]) => t === tab)?.[1] ?? '';
  return { title: course ? `${course.code} ${label.toLowerCase()}` : 'Course' };
}

type UpdateEntry =
  | { type: 'change'; at: string; change: { id: string; item_id: string; field: string; old_value: string | null; new_value: string | null; source: string | null } }
  | { type: 'page'; at: string; doc: { id: string; title: string; kind: string; source_url: string | null; meta: unknown } };

/** A watched page that changed: the summary when AI read it, and the raw added and removed lines. */
function PageUpdate({ doc, now, at }: { doc: { id: string; title: string; source_url: string | null; meta: unknown }; now: Date; at: string }) {
  const meta = (doc.meta ?? {}) as { label?: string; diff?: PageDiff | null; summary?: string | null };
  const label = meta.label ?? doc.title;
  const diff = meta.diff;
  return (
    <li className="grid gap-1 py-2">
      <span>
        {diff ? `${label} page changed.` : `Started watching the ${label} page.`}{' '}
        <Link href={`/library/${doc.id}`} className="text-tie underline-offset-2 hover:underline">
          Saved copy
        </Link>
        {doc.source_url ? (
          <>
            {', '}
            <a href={doc.source_url} target="_blank" rel="noopener noreferrer" className="text-tie underline-offset-2 hover:underline">
              open page
            </a>
          </>
        ) : null}{' '}
        <span className="text-muted-foreground">{formatAgo(new Date(at), now)}</span>
      </span>
      {meta.summary ? <span>{meta.summary}</span> : null}
      {diff ? <DiffLines diff={diff} /> : null}
    </li>
  );
}

/** A paste filed under this course (announcement, outline, grades...). */
function PasteUpdate({ doc, now, at }: { doc: { id: string; title: string; kind: string; meta: unknown }; now: Date; at: string }) {
  const meta = (doc.meta ?? {}) as { summary?: string | null };
  return (
    <li className="grid gap-1 py-2">
      <span>
        {documentKindLabel(doc.kind)} pasted:{' '}
        <Link href={`/library/${doc.id}`} className="text-tie underline-offset-2 hover:underline">
          {doc.title}
        </Link>{' '}
        <span className="text-muted-foreground">{formatAgo(new Date(at), now)}</span>
      </span>
      {meta.summary ? <span>{meta.summary}</span> : null}
    </li>
  );
}

/** A Piazza email: the summary when AI read it, else subject and sender, with a link to the post. */
function EmailUpdate({ doc, now, at }: { doc: { id: string; title: string; source_url: string | null; meta: unknown }; now: Date; at: string }) {
  const meta = (doc.meta ?? {}) as { summary?: string | null; from?: string };
  const sender = meta.from?.replace(/\s*<[^>]*>\s*$/, '').replace(/^"|"$/g, '').trim();
  return (
    <li className="grid gap-1 py-2">
      <span>
        Piazza:{' '}
        <Link href={`/library/${doc.id}`} className="text-tie underline-offset-2 hover:underline">
          {doc.title}
        </Link>
        {doc.source_url ? (
          <>
            {', '}
            <a href={doc.source_url} target="_blank" rel="noopener noreferrer" className="text-tie underline-offset-2 hover:underline">
              open post
            </a>
          </>
        ) : null}{' '}
        <span className="text-muted-foreground">{formatAgo(new Date(at), now)}</span>
      </span>
      {sender ? <span className="text-muted-foreground">From {sender}</span> : null}
      {meta.summary ? <span>{meta.summary}</span> : null}
    </li>
  );
}

/** Piazza posts Claude judged to have nothing to act on (student questions, social posts). */
const isNoise = (doc: { kind: string; meta: unknown }) =>
  doc.kind === 'piazza_email' && (doc.meta as { importance?: string } | null)?.importance === 'noise';

export default async function CourseTabPage({ params, searchParams }: PageProps<'/courses/[slug]/[tab]'>) {
  const { slug, tab } = await params;
  const sp = await searchParams;
  const course = await getCourseBySlug(slug);
  if (!course || !COURSE_TABS.some(([t]) => t === tab)) notFound();
  const { supabase, user } = await getAppContext();
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
        <NotesList supabase={supabase} courses={[course]} filters={readNotesFilters(sp, [course])} action={`/courses/${course.slug}/notes`} fixedCourse={course} />
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
      {
        const data = await askPageData(supabase, user.id, course.id);
        return (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_260px]">
            <AskView
              threadId={null}
              initialScope={{ type: 'course', courseId: course.id }}
              options={data.options}
              messages={[]}
              aiReady={data.aiReady}
              overBudget={data.overBudget}
              navigate={false}
              lockCourse={course.id}
            />
            <section aria-labelledby="course-threads" className="grid content-start gap-2">
              <h3 id="course-threads" className="text-base font-semibold">
                Past {course.code} questions
              </h3>
              <AskThreads threads={data.threads} options={data.options} now={new Date()} />
            </section>
          </div>
        );
      }

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
          .select('id, title, kind, source_url, captured_at, meta')
          .eq('course_id', course.id)
          .order('captured_at', { ascending: false })
          .limit(80),
      ]);
      const showNoise = sp.noise === '1';
      const hidden = (snapshots ?? []).filter(isNoise).length;
      const feed: UpdateEntry[] = [
        ...(changes ?? []).map((c) => ({ type: 'change' as const, at: c.detected_at, change: c })),
        ...(snapshots ?? []).filter((d) => showNoise || !isNoise(d)).map((d) => ({ type: 'page' as const, at: d.captured_at, doc: d })),
      ].sort((a, b) => b.at.localeCompare(a.at));
      const noiseToggle = hidden ? (
        <p className="text-sm">
          <Link
            href={showNoise ? `/courses/${course.slug}/updates` : `/courses/${course.slug}/updates?noise=1`}
            className="text-tie underline-offset-2 hover:underline"
          >
            {showNoise ? 'Hide Piazza posts with nothing to act on' : `Show ${hidden} hidden Piazza ${hidden === 1 ? 'post' : 'posts'}`}
          </Link>
        </p>
      ) : null;
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
            Date changes, page edits, Piazza posts, and pasted announcements show up here.
          </EmptyState>
        );
      }
      return (
        <div className="grid gap-2">
          {noiseToggle}
          <ul className="divide-y divide-rule text-sm">
            {feed.map((e) =>
              e.type === 'change' ? (
                <li key={e.change.id} className="py-2">
                  <Link href={`/items/${e.change.item_id}`} className="underline-offset-2 hover:underline">
                    {describeChange(titles.get(e.change.item_id) ?? 'An item', e.change)}.
                  </Link>{' '}
                  <span className="text-muted-foreground">{formatAgo(new Date(e.at), now)}</span>
                </li>
              ) : e.doc.kind === 'page_snapshot' ? (
                <PageUpdate key={e.doc.id} doc={e.doc} at={e.at} now={now} />
              ) : e.doc.kind === 'piazza_email' ? (
                <EmailUpdate key={e.doc.id} doc={e.doc} at={e.at} now={now} />
              ) : (
                <PasteUpdate key={e.doc.id} doc={e.doc} at={e.at} now={now} />
              ),
            )}
          </ul>
        </div>
      );
    }

    case 'grades':
      return <CourseGrades course={course} />;

    case 'library': {
      const { courses } = await getAppContext();
      return (
        <LibraryList
          supabase={supabase}
          courses={courses}
          filters={readLibraryFilters(sp, courses)}
          action={`/courses/${course.slug}/library`}
          fixedCourse={course}
        />
      );
    }
  }
  notFound();
}
