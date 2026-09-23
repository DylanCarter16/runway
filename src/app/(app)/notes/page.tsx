import { NotesList, readNotesFilters } from '@/components/app/notes-list';
import { getAppContext } from '@/lib/db/queries';

export const metadata = { title: 'Notes' };

export default async function NotesPage({ searchParams }: PageProps<'/notes'>) {
  const sp = await searchParams;
  const { supabase, courses } = await getAppContext();
  return (
    <div className="grid max-w-4xl gap-6">
      <h2 className="text-2xl font-semibold">Notes</h2>
      <NotesList supabase={supabase} courses={courses} filters={readNotesFilters(sp, courses)} action="/notes" />
    </div>
  );
}
