'use client';

import type { ItemKind } from '@/config/term-f26';
import type { CourseLite } from '@/lib/db/queries';
import { EXAM_KINDS, FLAG_LABEL, KIND_LABEL } from '@/lib/items/labels';
import { runwayState } from '@/lib/items/runway';
import { formatCountdown, formatListDate, formatTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { courseStyle } from './course-mark';
import { ProgressControl } from './progress-control';
import { RunwayBar } from './runway-bar';
import { useShell } from './shell-provider';

export interface RowItem {
  id: string;
  course_id: string | null;
  kind: string;
  title: string;
  due_at: string | null;
  starts_at: string | null;
  time_known: boolean;
  progress: string;
  prep_days: number | null;
  location: string | null;
  seat?: string | null;
  flags: string[];
}

export const ROW_FIELDS = 'id, course_id, kind, title, due_at, starts_at, ends_at, time_known, progress, prep_days, location, seat, flags, weight_percent, source, state';

/** One deadline row: 4px course bar, title, kind, due, countdown, runway bar, progress. */
export function ItemRow({
  item,
  now,
  showDate = false,
  note,
}: {
  item: RowItem;
  now: Date;
  showDate?: boolean;
  note?: string | null;
}) {
  const { courses, openItem } = useShell();
  const course: CourseLite | null = courses.find((c) => c.id === item.course_id) ?? null;
  const kind = item.kind as ItemKind;
  const at = item.due_at ?? item.starts_at;
  const date = at ? new Date(at) : null;
  const state = runwayState({ ...item, kind, courseSlug: course?.slug ?? null }, now);
  const countdown = date ? formatCountdown(date, item.time_known, now) : 'no date yet';
  const urgent = state.status === 'overdue' ? 'text-late' : state.status === 'soon' ? 'text-soon' : 'text-muted-foreground';
  const verb = EXAM_KINDS.includes(kind) || kind === 'tutorial' || kind === 'lab' ? 'at' : 'due';

  return (
    <li
      data-course=""
      style={courseStyle(course)}
      className="relative border-b border-rule last:border-b-0"
    >
      <span aria-hidden className="absolute inset-y-2 left-0 w-1 rounded-full bg-(--course)" />
      <div className="grid gap-2 py-3 pr-1 pl-4 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-x-4">
        <button
          type="button"
          onClick={() => openItem(item.id)}
          className="grid min-h-11 gap-0.5 text-left focus-visible:outline-2"
        >
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-semibold">{item.title}</span>
            {item.flags
              .filter((f) => FLAG_LABEL[f])
              .map((f) => (
                <span key={f} className="rounded-md border border-soon px-1 text-xs text-soon">
                  {FLAG_LABEL[f]}
                </span>
              ))}
          </span>
          <span className="text-sm text-muted-foreground">
            {course ? `${course.code}, ` : ''}
            <span className={cn(EXAM_KINDS.includes(kind) && 'rounded-sm border border-graphite px-1 font-semibold text-foreground')}>
              {KIND_LABEL[kind]}
            </span>
            {item.location ? `, ${item.location}` : ''}
            {item.seat ? `, seat ${item.seat}` : ''}
          </span>
          <span className="text-sm tabular">
            {date ? (
              <>
                {showDate ? `${formatListDate(date)}, ` : ''}
                {item.time_known ? `${verb} ${formatTime(date)}` : 'time not set'}
                <span className={cn('ml-2', urgent)}>{countdown}</span>
              </>
            ) : (
              <span className="text-muted-foreground">No date yet</span>
            )}
          </span>
          {note ? <span className="text-sm text-muted-foreground">{note}</span> : null}
        </button>
        <div className="flex items-center justify-between gap-3 sm:justify-end">
          <ProgressControl itemId={item.id} progress={item.progress} compact />
        </div>
        <RunwayBar state={state} className="sm:col-span-2" />
      </div>
    </li>
  );
}
