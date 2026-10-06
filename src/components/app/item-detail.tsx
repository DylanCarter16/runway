'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ExternalLinkIcon, MessageCircleQuestionIcon, PencilIcon } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { setItemState, updateItem, type ItemDetail } from '@/app/(app)/actions';
import type { ItemKind } from '@/config/term.template';
import { EXAM_KINDS, FLAG_LABEL, KIND_LABEL, sourceLabel } from '@/lib/items/labels';
import { effectiveDue, runwayState } from '@/lib/items/runway';
import { formatAgo, formatCountdown, formatTime, formatWhen, toTorontoDate, toTorontoTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { CourseChip } from './course-mark';
import { emptyValues, ItemFormFields } from './item-form';
import { notifyItemChanged, ProgressControl } from './progress-control';
import { RunwayBar } from './runway-bar';
import { useShell } from './shell-provider';

const FIELD_LABEL: Record<string, string> = {
  title: 'Title',
  kind: 'Kind',
  starts_at: 'Start',
  due_at: 'Due',
  ends_at: 'End',
  all_day: 'All day',
  location: 'Location',
  seat: 'Seat',
  weight_percent: 'Weight',
  flags: 'Flags',
  state: 'State',
  progress: 'Progress',
  source_missing_at: 'Missing from source',
};

function changeValue(field: string, value: string | null): string {
  if (value === null || value === '') return 'none';
  if (['starts_at', 'due_at', 'ends_at', 'source_missing_at'].includes(field)) {
    return formatWhen(new Date(value), true);
  }
  return value;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

export function ItemDetailView({ detail, inDrawer = false }: { detail: ItemDetail; inDrawer?: boolean }) {
  const { courses } = useShell();
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const item = detail.item;
  const course = courses.find((c) => c.id === item.course_id) ?? null;
  const kind = item.kind as ItemKind;
  const now = new Date();
  const due = effectiveDue(item);
  const at = item.due_at ?? item.starts_at;
  const state = runwayState({ ...item, kind, courseSlug: course?.slug ?? null }, now);

  if (editing) {
    return (
      <ItemFormFields
        courses={courses}
        full
        initial={emptyValues({
          courseId: item.course_id ?? '',
          kind: item.kind,
          title: item.title,
          date: at ? toTorontoDate(new Date(at)) : '',
          time: at && item.time_known ? toTorontoTime(new Date(at)) : '',
          weight: item.weight_percent === null ? '' : String(item.weight_percent),
          location: item.location ?? '',
          seat: item.seat ?? '',
          description: item.description ?? '',
        })}
        submitLabel="Save changes"
        onCancel={() => setEditing(false)}
        onSubmit={async (form) => {
          const result = await updateItem(item.id, form);
          if (!result.ok) return result.error;
          toast.success('Saved');
          setEditing(false);
          notifyItemChanged();
          return null;
        }}
      />
    );
  }

  function toggleDismiss() {
    const next = item.state === 'active' ? 'dismissed' : 'active';
    startTransition(async () => {
      const result = await setItemState(item.id, next);
      if (!result.ok) toast.error(result.error);
      else {
        toast.success(next === 'dismissed' ? 'Dismissed' : 'Restored');
        notifyItemChanged();
      }
    });
  }

  const lastSync = detail.lastSync?.finished_at ? new Date(detail.lastSync.finished_at) : null;
  const sourceLine =
    item.source === 'manual'
      ? `Added by hand ${formatAgo(new Date(item.created_at), now)}`
      : item.source === 'seed'
        ? `From the course outline, loaded ${formatAgo(new Date(item.created_at), now)}`
        : `From ${sourceLabel(item.source)}, ${lastSync ? `synced ${formatAgo(lastSync, now)}` : 'not synced yet'}`;

  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <CourseChip course={course} />
          <span
            className={cn(
              'text-sm text-muted-foreground',
              EXAM_KINDS.includes(kind) && 'rounded-md border border-graphite px-1.5 font-semibold text-foreground',
            )}
          >
            {KIND_LABEL[kind]}
          </span>
          {item.flags.map((f) => (
            <span key={f} className="rounded-md border border-soon px-1.5 text-sm text-soon">
              {FLAG_LABEL[f] ?? f}
            </span>
          ))}
          {item.state === 'dismissed' ? <span className="text-sm text-late">Dismissed</span> : null}
        </div>
        {!inDrawer ? <h1 className="text-2xl font-semibold">{item.title}</h1> : null}
        {due ? (
          <p className="text-base tabular">
            {formatWhen(new Date(at!), item.time_known)}
            {item.ends_at && item.time_known ? ` to ${formatTime(new Date(item.ends_at))}` : ''}
            <span className="text-muted-foreground">, {formatCountdown(new Date(at!), item.time_known, now)}</span>
          </p>
        ) : (
          <p className="text-base text-muted-foreground">No date yet.</p>
        )}
        <RunwayBar state={state} size="drawer" showDates />
      </div>

      <ProgressControl itemId={item.id} progress={item.progress} />

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="h-11 sm:h-9" onClick={() => setEditing(true)}>
          <PencilIcon /> {due ? 'Edit' : 'Add date'}
        </Button>
        {item.source_url ? (
          <a href={item.source_url} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: 'outline' }), 'h-11 sm:h-9')}>
            <ExternalLinkIcon /> Open source
          </a>
        ) : null}
        {course?.ai_allowed ? (
          <Link href={`/ask?item=${item.id}`} className={cn(buttonVariants({ variant: 'outline' }), 'h-11 sm:h-9')}>
            <MessageCircleQuestionIcon /> Ask about this
          </Link>
        ) : null}
        <Button variant="ghost" className="h-11 sm:h-9" onClick={toggleDismiss} disabled={isPending}>
          {item.state === 'active' ? 'Dismiss' : 'Restore'}
        </Button>
        {inDrawer ? (
          <Link href={`/items/${item.id}`} className={cn(buttonVariants({ variant: 'link' }), 'h-11 sm:h-9')}>
            Open full page
          </Link>
        ) : null}
      </div>

      <dl className="divide-y divide-rule border-y border-rule">
        {item.location ? <Row label="Location">{item.location}</Row> : null}
        {item.seat ? <Row label="Seat">{item.seat}</Row> : null}
        {item.weight_percent !== null ? <Row label="Weight">{Number(item.weight_percent)}%</Row> : null}
        <Row label="Source">
          <span>{sourceLine}</span>
          {item.source_url ? (
            <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="block truncate text-link underline-offset-2 hover:underline">
              {item.source_url}
            </a>
          ) : null}
        </Row>
        {item.locked_fields.length ? (
          <Row label="Edited by hand">{item.locked_fields.map((f) => FIELD_LABEL[f] ?? f).join(', ')}</Row>
        ) : null}
      </dl>

      {item.description ? <p className="text-sm whitespace-pre-wrap">{item.description}</p> : null}

      {detail.course?.late_policy ? (
        <section className="grid gap-1">
          <h2 className="text-sm font-semibold">Late policy</h2>
          <p className="text-sm text-muted-foreground">{detail.course.late_policy}</p>
        </section>
      ) : null}

      {detail.course?.checklist.length ? (
        <section className="grid gap-1">
          <h2 className="text-sm font-semibold">Before you submit</h2>
          <ul className="list-disc pl-5 text-sm text-muted-foreground">
            {detail.course.checklist.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="grid gap-1">
        <h2 className="text-sm font-semibold">Change history</h2>
        {detail.changes.length ? (
          <ul className="divide-y divide-rule text-sm">
            {detail.changes.map((c) => (
              <li key={c.id} className="py-1.5">
                {FIELD_LABEL[c.field] ?? c.field} changed from {changeValue(c.field, c.old_value)} to {changeValue(c.field, c.new_value)}
                <span className="block text-xs text-muted-foreground">
                  {sourceLabel(c.source ?? 'unknown')}, {formatAgo(new Date(c.detected_at), now)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No changes since it was added.</p>
        )}
      </section>
    </div>
  );
}
