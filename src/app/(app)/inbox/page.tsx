import { PasteBox } from '@/components/app/paste-box';
import { ReviewQueue } from '@/components/app/review-queue';
import { getAppContext, toLite } from '@/lib/db/queries';
import { PASTE_KINDS } from '@/lib/inbox/kinds';
import { loadReviewGroups } from '@/lib/inbox/queue';
import type { PasteInput } from './actions';

export const metadata = { title: 'Inbox' };

export default async function InboxPage({ searchParams }: PageProps<'/inbox'>) {
  const params = await searchParams;
  const { supabase, courses } = await getAppContext();
  const { groups } = await loadReviewGroups(supabase, courses);

  const courseParam = typeof params.course === 'string' ? params.course : '';
  const initialCourse = courseParam === 'none' ? 'none' : (courses.find((c) => c.slug === courseParam || c.id === courseParam)?.id ?? '');
  const kindParam = typeof params.kind === 'string' ? params.kind : 'detect';
  const initialKind = (PASTE_KINDS.some((k) => k.value === kindParam) ? kindParam : 'detect') as PasteInput['kind'];

  return (
    <div className="grid max-w-3xl gap-8">
      <h2 className="text-2xl font-semibold">Inbox</h2>
      <PasteBox courses={courses.map(toLite)} initialCourse={initialCourse} initialKind={initialKind} />
      <ReviewQueue groups={groups} courses={courses.map(toLite)} />
      <section id="paste-reminders" className="grid gap-2">
        <h3 className="text-[21px] font-semibold">Paste reminders</h3>
        <p className="text-sm text-muted-foreground">No paste reminders due.</p>
      </section>
    </div>
  );
}
