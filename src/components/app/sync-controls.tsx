'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { removeLearnFeed, runSyncNow, saveLearnFeed } from '@/app/(app)/settings/actions';
import type { RunTarget } from '@/lib/jobs/types';

/** Starts a sync, then refreshes the page a few times so the result shows up. */
export function RunNowButton({ target, label = 'Run now' }: { target: RunTarget; label?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      className="h-11 sm:h-8"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await runSyncNow(target);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success(result.data.queued ? 'Sync started. Results appear here in a few seconds.' : 'That sync is already running.');
          for (const ms of [4000, 10000, 20000]) setTimeout(() => router.refresh(), ms);
        })
      }
    >
      {isPending ? 'Starting' : label}
    </Button>
  );
}

export function LearnFeedForm({ saved }: { saved: boolean }) {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await saveLearnFeed(url);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setUrl('');
          toast.success('Feed saved. The first sync is running.');
          router.refresh();
          setTimeout(() => router.refresh(), 8000);
        });
      }}
    >
      <label htmlFor="learn-feed" className="text-sm font-semibold">
        {saved ? 'Replace the feed URL' : 'Feed URL'}
      </label>
      <Input
        id="learn-feed"
        type="url"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        placeholder="https://learn.uwaterloo.ca/d2l/le/calendar/feed/..."
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'learn-feed-error' : 'learn-feed-help'}
        className="h-11 sm:h-9"
      />
      {error ? (
        <p id="learn-feed-error" role="alert" className="text-sm text-late">
          {error}
        </p>
      ) : (
        <p id="learn-feed-help" className="text-sm text-muted-foreground">
          LEARN, Calendar, Settings: turn on calendar feeds. Then Subscribe, choose all calendars and tasks, and copy the URL. It is stored
          encrypted and never shown again.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="h-11 sm:h-9" disabled={isPending || !url.trim()}>
          {isPending ? 'Saving' : 'Save feed'}
        </Button>
        {saved ? (
          <Button
            type="button"
            variant="outline"
            className="h-11 sm:h-9"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await removeLearnFeed();
                if (!result.ok) toast.error(result.error);
                else {
                  toast.success('Feed removed');
                  router.refresh();
                }
              })
            }
          >
            Remove feed
          </Button>
        ) : null}
      </div>
    </form>
  );
}
