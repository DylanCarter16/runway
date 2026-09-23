import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getAppContext } from '@/lib/db/queries';
import { formatListDate, formatTime } from '@/lib/time';

export const metadata = { title: 'Document' };

export default async function DocumentPage({ params }: PageProps<'/library/[id]'>) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { supabase, courses } = await getAppContext();
  const { data: doc } = await supabase.from('documents').select('*').eq('id', id).maybeSingle();
  if (!doc) notFound();
  const course = courses.find((c) => c.id === doc.course_id);
  const at = new Date(doc.captured_at);
  return (
    <article className="grid gap-4">
      <h2 className="text-2xl font-semibold">{doc.title}</h2>
      <p className="text-sm text-muted-foreground">
        {[course?.code, doc.kind.replace(/_/g, ' '), `captured ${formatListDate(at)}, ${formatTime(at)}`].filter(Boolean).join(', ')}
      </p>
      {doc.source_url ? (
        <a href={doc.source_url} target="_blank" rel="noopener noreferrer" className="text-sm text-tie underline-offset-2 hover:underline">
          {doc.source_url}
        </a>
      ) : null}
      <pre className="max-w-[68ch] overflow-x-auto rounded-md border border-rule bg-sheet p-4 font-serif text-[18px] leading-[1.65] whitespace-pre-wrap">
        {doc.raw_text}
      </pre>
    </article>
  );
}
