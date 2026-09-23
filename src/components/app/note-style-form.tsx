'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { saveNoteStyle } from '@/app/(app)/settings/actions';

/** Settings, AI: the style line the note cleanup prompt uses. */
export function NoteStyleForm({ style, fallback }: { style: string | null; fallback: string }) {
  const [value, setValue] = useState(style ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="grid max-w-2xl gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const res = await saveNoteStyle({ style: value });
          if (!res.ok) setError(res.error);
          else toast.success('Saved');
        });
      }}
    >
      <label htmlFor="note-style" className="text-sm font-semibold">
        Note cleanup style
      </label>
      <Textarea id="note-style" rows={3} value={value} onChange={(e) => setValue(e.target.value)} placeholder={fallback} maxLength={1000} />
      <p className="text-sm text-muted-foreground">Empty uses the default shown. Cleanup never adds facts, whatever the style says.</p>
      {error ? (
        <p role="alert" className="text-sm text-late">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={isPending} className="h-11 sm:h-9">
          Save style
        </Button>
      </div>
    </form>
  );
}
