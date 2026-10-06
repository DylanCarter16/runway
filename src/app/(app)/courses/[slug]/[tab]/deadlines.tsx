import { Suspense } from 'react';
import { AddItemButton, OpenItemButton } from '@/components/app/quick-actions';
import { RunwayBar } from '@/components/app/runway-bar';
import { UrlSelect } from '@/components/app/url-select';
import type { ItemKind } from '@/config/term.template';
import type { Course } from '@/lib/db/queries';
import { getAppContext } from '@/lib/db/queries';
import { EXAM_KINDS, ITEM_KINDS, KIND_LABEL, PROGRESS_LABEL, sourceLabel, type Progress } from '@/lib/items/labels';
import { runwayState } from '@/lib/items/runway';
import { formatListDate, formatTime } from '@/lib/time';
import { cn } from '@/lib/utils';

export async function CourseDeadlines({ course, kind, progress }: { course: Course; kind: string | null; progress: string | null }) {
  const { supabase } = await getAppContext();
  const now = new Date();
  let query = supabase
    .from('items')
    .select('id, kind, title, due_at, starts_at, time_known, weight_percent, progress, source, prep_days, flags')
    .eq('course_id', course.id)
    .eq('state', 'active')
    .order('due_at', { ascending: true, nullsFirst: false });
  if (kind) query = query.eq('kind', kind);
  if (progress) query = query.eq('progress', progress);
  const { data } = await query;
  const items = data ?? [];
  const { data: grades } = await supabase.from('grades').select('item_id, score, out_of').eq('course_id', course.id);
  const gradeByItem = new Map((grades ?? []).filter((g) => g.item_id).map((g) => [g.item_id!, g]));

  const dated = items.filter((i) => i.due_at || i.starts_at);
  const undated = items.filter((i) => !i.due_at && !i.starts_at);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Suspense>
          <UrlSelect param="kind" label="Kind" allLabel="All kinds" options={ITEM_KINDS.map((k) => [k, KIND_LABEL[k]])} className="w-40" />
          <UrlSelect
            param="progress"
            label="Progress"
            allLabel="Any progress"
            options={(Object.keys(PROGRESS_LABEL) as Progress[]).map((p) => [p, PROGRESS_LABEL[p]])}
            className="w-40"
          />
        </Suspense>
        <AddItemButton defaults={{ courseId: course.id }} className="ml-auto" />
      </div>

      <table className="w-full text-sm">
        <thead className="sr-only sm:not-sr-only">
          <tr className="border-b border-rule text-left text-muted-foreground">
            <th className="py-2 pr-3 font-normal">Title</th>
            <th className="py-2 pr-3 font-normal">Kind</th>
            <th className="py-2 pr-3 font-normal">Due</th>
            <th className="py-2 pr-3 text-right font-normal">Weight</th>
            <th className="py-2 pr-3 font-normal">Progress</th>
            <th className="py-2 pr-3 font-normal">Grade</th>
            <th className="py-2 font-normal">Source</th>
          </tr>
        </thead>
        <tbody>
          {[...dated, ...undated].map((i) => {
            const k = i.kind as ItemKind;
            const at = i.due_at ?? i.starts_at;
            const state = runwayState({ ...i, kind: k, courseSlug: course.slug }, now);
            const grade = gradeByItem.get(i.id);
            return (
              <tr key={i.id} className="grid grid-cols-2 gap-x-3 border-b border-rule py-2 sm:table-row sm:py-0">
                <td className="col-span-2 sm:py-2 sm:pr-3">
                  <OpenItemButton id={i.id} className="min-h-11 font-semibold underline-offset-2 hover:underline sm:min-h-0">
                    {i.title}
                  </OpenItemButton>
                  <RunwayBar state={state} size="table" className="mt-1 max-w-48" />
                </td>
                <td className={cn('text-muted-foreground sm:py-2 sm:pr-3', EXAM_KINDS.includes(k) && 'font-semibold text-foreground')}>{KIND_LABEL[k]}</td>
                <td className="tabular sm:py-2 sm:pr-3">
                  {at ? (
                    <>
                      {formatListDate(new Date(at))}
                      <span className="block text-xs text-muted-foreground">{i.time_known ? formatTime(new Date(at)) : 'time not set'}</span>
                    </>
                  ) : (
                    <OpenItemButton id={i.id} className="text-link underline-offset-2 hover:underline">
                      Add date
                    </OpenItemButton>
                  )}
                </td>
                <td className="tabular sm:py-2 sm:pr-3 sm:text-right">{i.weight_percent !== null ? `${Number(i.weight_percent)}%` : ''}</td>
                <td className="sm:py-2 sm:pr-3">{PROGRESS_LABEL[i.progress as Progress]}</td>
                <td className="tabular sm:py-2 sm:pr-3">{grade && grade.score !== null ? `${grade.score}${grade.out_of ? ` / ${grade.out_of}` : ''}` : ''}</td>
                <td className="text-xs text-muted-foreground sm:py-2">{sourceLabel(i.source)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!items.length ? <p className="text-sm text-muted-foreground">No items match these filters.</p> : null}
    </div>
  );
}
