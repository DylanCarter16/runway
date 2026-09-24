'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { savePiazzaMap } from '@/app/(app)/settings/actions';
import { selectClass } from '@/lib/ui';

export interface PiazzaClassRow {
  nid: string;
  url: string;
  /** Emails stored from this class, and how many wait for a course. */
  emails: number;
  waiting: number;
}

/** Settings, Courses: a course for each Piazza class. Emails find their course through this. */
export function PiazzaMapForm({
  classes,
  courses,
  map,
}: {
  classes: PiazzaClassRow[];
  courses: { slug: string; code: string }[];
  map: Record<string, string>;
}) {
  const [value, setValue] = useState<Record<string, string>>(() => Object.fromEntries(classes.map((c) => [c.nid, map[c.nid] ?? ''])));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const res = await savePiazzaMap({ map: value });
          if (!res.ok) setError(res.error);
          else toast.success(res.data.moved ? `Saved. ${res.data.moved} waiting ${res.data.moved === 1 ? 'email' : 'emails'} filed.` : 'Saved');
        });
      }}
    >
      <ul className="grid gap-3">
        {classes.map((c) => (
          <li key={c.nid} className="grid gap-1 sm:grid-cols-[1fr_12rem] sm:items-center sm:gap-4">
            <label htmlFor={`piazza-${c.nid}`} className="grid gap-0.5 text-sm">
              <a href={c.url} target="_blank" rel="noopener noreferrer" className="break-all font-semibold text-link underline-offset-2 hover:underline">
                {c.url.replace(/^https:\/\//, '')}
              </a>
              <span className="text-muted-foreground">
                {c.emails ? `${c.emails} ${c.emails === 1 ? 'email' : 'emails'} stored` : 'No emails yet'}
                {c.waiting ? `, ${c.waiting} waiting for a course` : ''}
              </span>
            </label>
            <select
              id={`piazza-${c.nid}`}
              className={selectClass}
              value={value[c.nid] ?? ''}
              onChange={(e) => setValue((v) => ({ ...v, [c.nid]: e.target.value }))}
            >
              <option value="">No course</option>
              {courses.map((course) => (
                <option key={course.slug} value={course.slug}>
                  {course.code}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-sm text-late">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={isPending} className="h-11 sm:h-9">
          Save Piazza classes
        </Button>
      </div>
    </form>
  );
}
