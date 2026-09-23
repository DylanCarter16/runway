'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { saveAskSettings } from '@/app/(app)/settings/actions';

/** Settings, AI: the style line Ask answers in and how many tokens of notes it may send. */
export function AskSettingsForm({ style, budget, fallback }: { style: string | null; budget: number; fallback: string }) {
  const [value, setValue] = useState(style ?? '');
  const [tokens, setTokens] = useState(String(budget));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="grid max-w-2xl gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const res = await saveAskSettings({ style: value, budget: tokens });
          if (!res.ok) setError(res.error);
          else toast.success('Saved');
        });
      }}
    >
      <label htmlFor="answer-style" className="text-sm font-semibold">
        Answer style
      </label>
      <Textarea id="answer-style" rows={3} value={value} onChange={(e) => setValue(e.target.value)} placeholder={fallback} maxLength={1000} />
      <p className="text-sm text-muted-foreground">Empty uses the default shown.</p>
      <label htmlFor="ask-budget" className="mt-2 text-sm font-semibold">
        Context budget (tokens)
      </label>
      <Input id="ask-budget" type="number" inputMode="numeric" min={5000} max={200000} step={1000} value={tokens} onChange={(e) => setTokens(e.target.value)} className="max-w-40" />
      <p className="text-sm text-muted-foreground">
        A course&apos;s notes go to Claude whole when they fit in this many tokens. Past that, Ask sends the passages that best match the question.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-late">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={isPending} className="h-11 sm:h-9">
          Save Ask settings
        </Button>
      </div>
    </form>
  );
}
