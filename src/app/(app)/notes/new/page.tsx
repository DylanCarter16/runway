import { NoteForm } from '@/components/app/note-form';
import { getAppContext, toLite } from '@/lib/db/queries';
import { breakRanges, defaultLectureDate, type MeetingRow } from '@/lib/notes/lecture-days';
import { toTorontoDate } from '@/lib/time';

export const metadata = { title: 'New note' };

export default async function NewNotePage({ searchParams }: PageProps<'/notes/new'>) {
  const params = await searchParams;
  const { supabase, courses } = await getAppContext();
  const { data: breaks } = await supabase.from('items').select('due_at, starts_at, ends_at').eq('kind', 'break').eq('state', 'active');
  const today = toTorontoDate(new Date());
  const ranges = breakRanges(breaks ?? []);
  const defaultDates = Object.fromEntries(courses.map((c) => [c.id, defaultLectureDate((c.meetings ?? []) as MeetingRow[], today, ranges)]));
  const courseParam = typeof params.course === 'string' ? params.course : '';
  const initialCourse = courses.find((c) => c.slug === courseParam || c.id === courseParam)?.id ?? '';

  return (
    <div className="grid gap-6">
      <h2 className="text-2xl font-semibold">New note</h2>
      <NoteForm courses={courses.map(toLite)} initialCourse={initialCourse} defaultDates={defaultDates} today={today} />
    </div>
  );
}
