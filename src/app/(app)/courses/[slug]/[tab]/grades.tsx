import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/app/empty-state';
import { AddMarkForm, FinalCalculator, MarkControls } from '@/components/app/grades-controls';
import type { Course } from '@/lib/db/queries';
import { getAppContext } from '@/lib/db/queries';
import { courseStanding, formatPercent, type CountedMark, type SchemeComponent } from '@/lib/grades/scheme';
import { sourceLabel } from '@/lib/items/labels';
import { formatListDate } from '@/lib/time';
import { cn } from '@/lib/utils';

interface MarkSource {
  source: string;
  source_document_id: string | null;
  recorded_at: string;
}

/** Grades tab (SPEC 4.3, Phase 8): marks by component, running average, what the final needs. */
export async function CourseGrades({ course }: { course: Course }) {
  const { supabase } = await getAppContext();
  const { data } = await supabase
    .from('grades')
    .select('id, label, score, out_of, component, source, source_document_id, recorded_at, items(title)')
    .eq('course_id', course.id)
    .order('recorded_at');
  const rows = data ?? [];
  const scheme = ((course.grading_scheme ?? []) as unknown as SchemeComponent[]).filter((c) => c && typeof c.component === 'string');
  const standing = courseStanding(
    scheme,
    rows.map((r) => ({ id: r.id, label: r.label, score: r.score, out_of: r.out_of, component: r.component, item_title: r.items?.title ?? null })),
  );
  const sources = new Map<string, MarkSource>(rows.map((r) => [r.id, r]));
  const componentNames = scheme.map((c) => c.component);
  const pasteHref = `/inbox?course=${course.slug}&kind=grade_paste`;

  const pasteLink = (
    <Link href={pasteHref} className={cn(buttonVariants({ variant: 'outline' }), 'h-11 sm:h-9')}>
      Paste grades
    </Link>
  );

  if (!scheme.length && !rows.length) {
    return (
      <EmptyState title={`No grading scheme or marks for ${course.code} yet.`} action={pasteLink}>
        Paste the course outline in the Inbox to load the grading scheme, then paste marks from LEARN, Crowdmark, Marmoset, or MarkUs.
      </EmptyState>
    );
  }

  const markRow = (m: CountedMark, note: string | null) => {
    const src = sources.get(m.id);
    return (
      <li key={m.id} className="grid gap-1.5 py-2 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-4">
        <div className="grid gap-0.5">
          <span>
            <span className="font-semibold">{m.label}</span>{' '}
            <span className="tabular">
              {m.score === null ? 'no score' : m.out_of === null ? String(m.score) : `${m.score} / ${m.out_of}`}
              {m.percent !== null ? ` (${formatPercent(m.percent)})` : ''}
            </span>
            {note ? <span className="text-muted-foreground"> {note}</span> : null}
          </span>
          {src ? (
            <span className="text-sm text-muted-foreground">
              {src.source_document_id ? (
                <Link href={`/library/${src.source_document_id}`} className="text-link underline-offset-2 hover:underline">
                  {sourceLabel(src.source)}
                </Link>
              ) : (
                sourceLabel(src.source)
              )}
              , {formatListDate(new Date(src.recorded_at))}
            </span>
          ) : null}
        </div>
        <MarkControls id={m.id} label={m.label} component={m.guessed ? null : m.component} components={componentNames} />
      </li>
    );
  };

  const finalMarked = standing.final?.percent !== null && standing.final?.percent !== undefined;

  return (
    <div className="grid max-w-3xl gap-8">
      <section className="grid gap-2">
        <h3 className="text-lg font-semibold">Running average</h3>
        {standing.average === null ? (
          <p className="text-muted-foreground">No marks count toward the average yet.</p>
        ) : (
          <>
            <p className="tabular text-3xl font-semibold">{formatPercent(standing.average)}</p>
            <p className="text-sm text-muted-foreground">
              Over the {formatPercent(standing.gradedWeight)} of the course marked so far. You have{' '}
              <span className="tabular">{formatPercent(standing.earned)}</span> of the {formatPercent(standing.totalWeight)} available.
            </p>
          </>
        )}
        <div className="flex flex-wrap gap-2 pt-1">{pasteLink}</div>
      </section>

      <section className="grid gap-3">
        <h3 className="text-lg font-semibold">By component</h3>
        {scheme.length ? null : <p className="text-muted-foreground">No grading scheme yet. Paste the outline in the Inbox to add it.</p>}
        <ul className="grid gap-4">
          {standing.components.map((c) => (
            <li key={c.component} className="grid gap-1 border-t border-rule pt-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                <span className="font-semibold">
                  {c.component} <span className="tabular font-normal text-muted-foreground">{formatPercent(c.weight)}</span>
                </span>
                <span className="tabular">
                  {c.percent === null ? <span className="text-muted-foreground">No marks</span> : `${formatPercent(c.percent)}, ${formatPercent(c.earned!)} of ${formatPercent(c.weight)}`}
                </span>
              </div>
              {c.notes ? <p className="text-sm text-muted-foreground">{c.notes}</p> : null}
              {c.marks.length ? (
                <ul className="divide-y divide-rule">
                  {c.marks.map((m) =>
                    markRow(m, m.percent !== null && !m.counted && c.bestOf ? `Not counted (best ${c.bestOf.keep} of ${c.bestOf.of})` : null),
                  )}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
        {standing.unassigned.length ? (
          <div className="grid gap-1 border-t border-rule pt-3">
            <span className="font-semibold">Not in the grading scheme</span>
            <p className="text-sm text-muted-foreground">These don’t count toward the average. Pick the component each one belongs to.</p>
            <ul className="divide-y divide-rule">{standing.unassigned.map((m) => markRow(m, null))}</ul>
          </div>
        ) : null}
        {scheme.length ? (
          <p className="text-sm text-muted-foreground">
            Each mark in a component counts the same. Rules in the notes above, such as a better midterm counting more, aren’t applied; check the outline.
          </p>
        ) : null}
      </section>

      {standing.final && !finalMarked ? (
        <section className="grid gap-3">
          <h3 className="text-lg font-semibold">What you need on the final</h3>
          <FinalCalculator standing={standing} />
        </section>
      ) : null}

      <section className="grid gap-3">
        <h3 className="text-lg font-semibold">Add a mark</h3>
        <AddMarkForm courseId={course.id} components={componentNames} />
      </section>
    </div>
  );
}
