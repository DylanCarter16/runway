'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { makeFeedLink, turnOffFeed } from '@/app/(app)/settings/actions';
import { cn } from '@/lib/utils';

/** Settings, Integrations: the read-only calendar feed for Apple Calendar. */
export function FeedControls({ url, webcal }: { url: string | null; webcal: string | null }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) toast.error(result.error ?? 'Something went wrong.');
      else {
        toast.success(done);
        router.refresh();
      }
    });
  }

  if (!url || !webcal) {
    return (
      <div>
        <Button className="h-11 sm:h-9" disabled={isPending} onClick={() => run(makeFeedLink, 'Feed link made')}>
          {isPending ? 'Making link' : 'Make feed link'}
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <label htmlFor="ics-feed" className="text-sm font-semibold">
        Feed link
      </label>
      <Input
        id="ics-feed"
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        aria-describedby="ics-feed-help"
        className="h-11 font-mono text-xs sm:h-9"
      />
      <p id="ics-feed-help" className="text-sm text-muted-foreground">
        Anyone with this link can read your deadlines, so keep it private. If it leaks, make a new link; the old one stops working.
      </p>
      <div className="flex flex-wrap gap-2">
        <a href={webcal} className={cn(buttonVariants(), 'h-11 sm:h-8')}>
          Subscribe in Apple Calendar
        </a>
        <Button
          variant="outline"
          className="h-11 sm:h-8"
          onClick={() =>
            navigator.clipboard.writeText(url).then(
              () => toast.success('Link copied'),
              () => toast.error('Could not copy. Select the link and copy it by hand.'),
            )
          }
        >
          Copy link
        </Button>
        <Button
          variant="ghost"
          className="h-11 sm:h-8"
          disabled={isPending}
          onClick={() => {
            if (!window.confirm('Make a new feed link? Calendars subscribed to the old link stop updating until you subscribe again.')) return;
            run(makeFeedLink, 'New link made. Subscribe again with it.');
          }}
        >
          Make a new link
        </Button>
        <Button
          variant="ghost"
          className="h-11 sm:h-8"
          disabled={isPending}
          onClick={() => {
            if (!window.confirm('Turn off the feed? Subscribed calendars stop updating.')) return;
            run(turnOffFeed, 'Feed turned off');
          }}
        >
          Turn off feed
        </Button>
      </div>
    </div>
  );
}
