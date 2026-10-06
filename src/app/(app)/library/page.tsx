import { LibraryList, readLibraryFilters } from '@/components/app/library-list';
import { LibraryUpload } from '@/components/app/library-upload';
import { getAppContext } from '@/lib/db/queries';

export const metadata = { title: 'Library' };

export default async function LibraryPage({ searchParams }: PageProps<'/library'>) {
  const sp = await searchParams;
  const { supabase, courses } = await getAppContext();
  return (
    <div className="grid gap-6">
      <h2 className="text-2xl font-semibold">Library</h2>
      <LibraryUpload courses={courses} />
      <LibraryList supabase={supabase} courses={courses} filters={readLibraryFilters(sp, courses)} action="/library" />
    </div>
  );
}
