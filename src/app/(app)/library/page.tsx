import Link from 'next/link';
import { EmptyState } from '@/components/app/empty-state';
import { getAppContext } from '@/lib/db/queries';
import { formatListDate } from '@/lib/time';

export const metadata = { title: 'Library' };

export default async function LibraryPage() {
  const { supabase, courses } = await getAppContext();
  const { data: docs } = await supabase
    .from('documents')
    .select('id, title, kind, course_id, captured_at')
    .order('captured_at', { ascending: false })
    .limit(200);
  const courseById = new Map(courses.map((c) => [c.id, c]));
  return (
    <div className="grid gap-6">
      <h2 className="text-2xl font-semibold">Library</h2>
      {docs?.length ? (
        <ul className="divide-y divide-rule border-y border-rule text-sm">
          {docs.map((d) => (
            <li key={d.id} className="py-2">
              <Link href={`/library/${d.id}`} className="font-semibold text-tie underline-offset-2 hover:underline">
                {d.title}
              </Link>
              <span className="block text-muted-foreground">
                {[d.course_id ? courseById.get(d.course_id)?.code : null, d.kind.replace(/_/g, ' '), formatListDate(new Date(d.captured_at))]
                  .filter(Boolean)
                  .join(', ')}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Nothing stored yet.">Everything you paste, and every page snapshot, is kept here word for word.</EmptyState>
      )}
    </div>
  );
}
