import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buttonVariants } from '@/components/ui/button';
import { CourseChip } from '@/components/app/course-mark';
import { IncrementalBanner } from '@/components/app/incremental-banner';
import { noteTitle } from '@/components/app/notes-list';
import { NoteView } from '@/components/app/note-view';
import { getAppContext } from '@/lib/db/queries';
import { FORMULA_WARNING } from '@/lib/notes/checks';
import { formatAgo, formatHeadingDate, fromTorontoLocal } from '@/lib/time';
import { cn } from '@/lib/utils';

export async function generateMetadata({ params }: PageProps<'/notes/[id]'>) {
  const { id } = await params;
  const { supabase } = await getAppContext();
  const { data } = await supabase.from('notes').select('title, original_md').eq('id', id).maybeSingle();
  return { title: data ? noteTitle(data) : 'Note' };
}

const askHref = (noteId: string, q?: string) => `/ask?note=${noteId}${q ? `&q=${encodeURIComponent(q)}` : ''}`;

export default async function NotePage({ params }: PageProps<'/notes/[id]'>) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase, courses } = await getAppContext();
  const [{ data: note }, { data: proposals }] = await Promise.all([
    supabase
      .from('notes')
      .select('id, course_id, lecture_on, title, original_md, cleaned_md, edited_md, cleanup_status, cleanup_error, cleanup_model, cleanup_instruction, cleaned_at, topics, summary, open_questions, created_at, source_document_id, incremental')
      .eq('id', id)
      .maybeSingle(),
    supabase.from('proposals').select('id, state').eq('source_note_id', id),
  ]);
  if (!note) notFound();
  const course = courses.find((c) => c.id === note.course_id) ?? null;
  const aiOn = Boolean(course?.ai_allowed);
  const pending = (proposals ?? []).filter((p) => p.state === 'pending').length;
  const approved = (proposals ?? []).filter((p) => p.state === 'approved').length;
  const questions = aiOn ? note.open_questions : [];
  const cut = note.incremental as { kind?: 'text' | 'file'; mode?: 'new' | 'whole'; summary?: string } | null;
  const now = new Date();

  return (
    <article className="grid max-w-5xl gap-6">
      <header className="grid gap-2">
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <CourseChip course={course} />
          <span>{note.lecture_on ? formatHeadingDate(fromTorontoLocal(note.lecture_on, null)) : 'No lecture date'}</span>
        </p>
        <h2 className="text-2xl font-semibold">{noteTitle(note)}</h2>
        {aiOn && note.topics.length ? (
          <ul aria-label="Topics" className="flex flex-wrap gap-1.5">
            {note.topics.map((t) => (
              <li key={t}>
                <Link href={`/notes?q=${encodeURIComponent(t)}`} className="rounded-md border border-rule px-2 py-0.5 text-sm text-muted-foreground hover:text-foreground">
                  {t}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        {aiOn && note.summary ? <p className="line-clamp-2 max-w-[68ch]">{note.summary}</p> : null}
        <p className="text-sm text-muted-foreground">
          Saved {formatAgo(new Date(note.created_at), now)}
          {aiOn && note.cleaned_at ? `. Cleaned ${formatAgo(new Date(note.cleaned_at), now)} by ${note.cleanup_model ?? 'Claude'}` : ''}.
        </p>
        {aiOn ? (
          <div>
            <Link href={askHref(note.id)} className={cn(buttonVariants({ variant: 'outline' }), 'h-11 sm:h-8')}>
              Ask about this note
            </Link>
          </div>
        ) : null}
      </header>

      {!aiOn && course ? (
        <aside className="grid max-w-[68ch] gap-1 border-l-2 border-rule pl-3 text-sm">
          <p>
            {course.code} has AI turned off, so this note is stored and searchable exactly as written, with no cleaned copy, topics, or summary.
          </p>
          {course.ai_policy ? (
            <blockquote className="text-muted-foreground">
              <span className="font-semibold">The outline says: </span>
              {course.ai_policy}
            </blockquote>
          ) : null}
        </aside>
      ) : null}

      {cut?.mode === 'new' && cut.summary ? (
        <IncrementalBanner noteId={note.id} summary={cut.summary} documentId={note.source_document_id} isFile={cut.kind === 'file'} />
      ) : null}

      <NoteView
        noteId={note.id}
        original={note.original_md}
        cleaned={aiOn ? note.cleaned_md : null}
        edited={aiOn ? note.edited_md : null}
        status={note.cleanup_status}
        error={note.cleanup_error}
        aiOn={aiOn}
        instruction={note.cleanup_instruction}
      />

      {questions.length ? (
        <section aria-labelledby="open-questions" className="grid gap-2">
          <h3 id="open-questions" className="text-lg font-semibold">
            Open questions
          </h3>
          <ul className="divide-y divide-rule border-y border-rule">
            {questions.map((q) => (
              <li key={q} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className={cn('max-w-[68ch]', q === FORMULA_WARNING && 'text-soon')}>{q}</span>
                {q === FORMULA_WARNING ? null : (
                  <Link href={askHref(note.id, q)} className="text-sm text-link underline-offset-2 hover:underline">
                    Ask about this
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {pending || approved ? (
        <section aria-labelledby="note-dates" className="grid gap-1 text-sm">
          <h3 id="note-dates" className="text-lg font-semibold">
            Dates in this note
          </h3>
          {pending ? (
            <p>
              <Link href="/inbox" className="text-link underline underline-offset-2">
                {pending === 1 ? '1 date change waits' : `${pending} date changes wait`} for review in the Inbox
              </Link>
              .
            </p>
          ) : null}
          {approved ? <p className="text-muted-foreground">{approved === 1 ? '1 change' : `${approved} changes`} from this note already approved.</p> : null}
        </section>
      ) : null}
    </article>
  );
}
