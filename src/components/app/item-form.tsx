'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { ItemForm } from '@/lib/items/edit';
import { ITEM_KINDS, KIND_LABEL } from '@/lib/items/labels';
import type { CourseLite } from '@/lib/db/queries';
import { selectClass } from '@/lib/ui';
import { cn } from '@/lib/utils';


export interface ItemFormValues {
  courseId: string;
  kind: string;
  title: string;
  date: string;
  time: string;
  weight: string;
  location: string;
  seat: string;
  description: string;
}

export function emptyValues(partial: Partial<ItemFormValues> = {}): ItemFormValues {
  return {
    courseId: '',
    kind: 'assignment',
    title: '',
    date: '',
    time: '',
    weight: '',
    location: '',
    seat: '',
    description: '',
    ...partial,
  };
}

export function toItemForm(v: ItemFormValues, full: boolean): ItemForm {
  const weight = v.weight.trim() === '' ? null : Number(v.weight);
  return {
    courseId: v.courseId || null,
    kind: v.kind,
    title: v.title,
    date: v.date || null,
    time: v.date && v.time ? v.time : null,
    weight: Number.isFinite(weight) ? weight : null,
    ...(full
      ? {
          location: v.location.trim() || null,
          seat: v.seat.trim() || null,
          description: v.description.trim() || null,
        }
      : {}),
  };
}

function Field({ label, htmlFor, children, className }: { label: string; htmlFor: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('grid gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-sm font-semibold">
        {label}
      </label>
      {children}
    </div>
  );
}

/** Fields shared by quick add and edit. `full` adds location, seat, and description. */
export function ItemFormFields({
  courses,
  initial,
  full = false,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  courses: CourseLite[];
  initial: ItemFormValues;
  full?: boolean;
  submitLabel: string;
  onSubmit: (form: ItemForm) => Promise<string | null>;
  onCancel?: () => void;
}) {
  const [v, setV] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const set = (key: keyof ItemFormValues) => (e: { target: { value: string } }) => setV({ ...v, [key]: e.target.value });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const message = await onSubmit(toItemForm(v, full));
      if (message) setError(message);
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Course" htmlFor="item-course">
          <select id="item-course" className={selectClass} value={v.courseId} onChange={set('courseId')}>
            <option value="">No course</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Kind" htmlFor="item-kind">
          <select id="item-kind" className={selectClass} value={v.kind} onChange={set('kind')}>
            {ITEM_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k].charAt(0).toUpperCase() + KIND_LABEL[k].slice(1)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Title" htmlFor="item-title">
        <Input id="item-title" className="h-11 sm:h-9" value={v.title} onChange={set('title')} placeholder="A1" required autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date" htmlFor="item-date">
          <Input id="item-date" className="h-11 sm:h-9" type="date" value={v.date} onChange={set('date')} />
        </Field>
        <Field label="Time (optional)" htmlFor="item-time">
          <Input id="item-time" className="h-11 sm:h-9" type="time" value={v.time} onChange={set('time')} disabled={!v.date} />
        </Field>
      </div>
      <Field label="Weight, % (optional)" htmlFor="item-weight">
        <Input id="item-weight" className="h-11 sm:h-9" type="number" inputMode="decimal" min={0} max={100} step="0.01" value={v.weight} onChange={set('weight')} />
      </Field>
      {full ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Location" htmlFor="item-location">
              <Input id="item-location" className="h-11 sm:h-9" value={v.location} onChange={set('location')} />
            </Field>
            <Field label="Seat" htmlFor="item-seat">
              <Input id="item-seat" className="h-11 sm:h-9" value={v.seat} onChange={set('seat')} />
            </Field>
          </div>
          <Field label="Details" htmlFor="item-description">
            <Textarea id="item-description" rows={4} value={v.description} onChange={set('description')} />
          </Field>
        </>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-late">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" className="h-11 sm:h-9" disabled={isPending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
