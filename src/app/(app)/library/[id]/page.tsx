import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { DiffLines, type PageDiff } from '@/components/app/page-diff';
import { getAppContext } from '@/lib/db/queries';
import { describeProposal } from '@/lib/inbox/describe';
import { documentKindLabel } from '@/lib/inbox/kinds';
import { formatListDate, formatTime, formatWhen } from '@/lib/time';

export const metadata = { title: 'Document' };

const STATE_LABEL: Record<string, string> = {
  pending: 'waiting for review',
  approved: 'approved',
  dismissed: 'dismissed',
  superseded: 'replaced by a newer proposal',
};

const STATUS_LABEL: Record<string, string> = {
  stored_only: 'Stored without extraction.',
  extracted: 'Read for dates and course info.',
  suggest_note: 'This looks like lecture notes.',
  failed: 'Reading it failed.',
};

export default async function DocumentPage({ params }: PageProps<'/library/[id]'>) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { supabase, courses } = await getAppContext();
  const { data: doc } = await supabase.from('documents').select('*').eq('id', id).maybeSingle();
  if (!doc) notFound();
  const [{ data: proposals }, { data: items }] = await Promise.all([
    supabase.from('proposals').select('id, kind, course_id, payload, state, created_at').eq('source_document_id', id).order('created_at'),
    supabase.from('items').select('id, title, due_at, starts_at, time_known').eq('source_document_id', id).order('due_at'),
  ]);
  const course = courses.find((c) => c.id === doc.course_id);
  const codeOf = new Map(courses.map((c) => [c.id, c.code]));
  const at = new Date(doc.captured_at);
  const meta = (doc.meta ?? {}) as {
    status?: string;
    notes?: string[];
    summary?: string | null;
    detected_kind?: string | null;
    declared_kind?: string;
    diff?: PageDiff | null;
    label?: string;
  };

  return (
    <article className="grid gap-6">
      <header className="grid gap-1">
        <h2 className="text-2xl font-semibold">{doc.title}</h2>
        <p className="text-sm text-muted-foreground">
          {[course?.code ?? 'No course', documentKindLabel(doc.kind), `captured ${formatListDate(at)}, ${formatTime(at)}`].join(', ')}
        </p>
        {doc.source_url ? (
          <a href={doc.source_url} target="_blank" rel="noopener noreferrer" className="text-sm break-all text-tie underline-offset-2 hover:underline">
            {doc.source_url}
          </a>
        ) : null}
      </header>

      {meta.status || meta.summary || meta.notes?.length ? (
        <section className="grid gap-1 text-sm">
          <h3 className="text-base font-semibold">What Runway did</h3>
          {meta.status ? <p>{STATUS_LABEL[meta.status] ?? meta.status}</p> : null}
          {meta.detected_kind ? <p className="text-muted-foreground">Detected as {documentKindLabel(meta.detected_kind)}.</p> : null}
          {meta.summary ? <p>{meta.summary}</p> : null}
          {meta.notes?.map((n) => (
            <p key={n} className="text-muted-foreground">
              {n}
            </p>
          ))}
          {!doc.processed_at && meta.declared_kind ? <p className="text-muted-foreground">Still being read.</p> : null}
        </section>
      ) : null}

      {proposals?.length ? (
        <section className="grid gap-2">
          <h3 className="text-base font-semibold">Proposals from this document</h3>
          <ul className="divide-y divide-rule border-y border-rule text-sm">
            {proposals.map((p) => (
              <li key={p.id} className="flex flex-wrap justify-between gap-x-3 py-2">
                <span>{describeProposal(p.kind, p.payload, p.course_id ? (codeOf.get(p.course_id) ?? null) : null).headline}</span>
                <span className="text-muted-foreground">
                  {p.state === 'pending' ? (
                    <Link href="/inbox#review" className="text-tie underline underline-offset-2">
                      {STATE_LABEL.pending}
                    </Link>
                  ) : (
                    (STATE_LABEL[p.state] ?? p.state)
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {items?.length ? (
        <section className="grid gap-2">
          <h3 className="text-base font-semibold">Items added from this document</h3>
          <ul className="divide-y divide-rule border-y border-rule text-sm">
            {items.map((i) => {
              const when = i.due_at ?? i.starts_at;
              return (
                <li key={i.id} className="py-2">
                  <Link href={`/items/${i.id}`} className="text-tie underline-offset-2 hover:underline">
                    {i.title}
                  </Link>
                  <span className="text-muted-foreground">, {when ? formatWhen(new Date(when), i.time_known) : 'no date yet'}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {doc.kind === 'page_snapshot' ? (
        <section className="grid gap-2">
          <h3 className="text-base font-semibold">Changes since the previous snapshot</h3>
          {meta.diff ? <DiffLines diff={meta.diff} max={200} /> : <p className="text-sm text-muted-foreground">This is the first snapshot of the page.</p>}
        </section>
      ) : null}

      <section className="grid gap-2">
        <h3 className="text-base font-semibold">{doc.kind === 'page_snapshot' ? 'Page text' : 'Stored text, exactly as received'}</h3>
        <pre className="max-w-[68ch] overflow-x-auto rounded-md border border-rule bg-sheet p-4 font-serif text-[18px] leading-[1.65] whitespace-pre-wrap">
          {doc.raw_text}
        </pre>
      </section>
    </article>
  );
}
