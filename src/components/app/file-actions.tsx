'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { extractPages, getFileStatus, retryFailedPages } from '@/app/(app)/files/actions';
import { combinedStatus, pollStep, startPoll, type PollState } from '@/lib/files/poll';

/**
 * While files are being read, checks their status and reloads the page only when one changed,
 * less often the longer nothing changes, and not at all after 15 quiet minutes (src/lib/files/poll.ts).
 */
export function RefreshWhileReading({ documentIds, active }: { documentIds: string[]; active: boolean }) {
  const router = useRouter();
  const ids = documentIds.join(',');
  useEffect(() => {
    if (!active || !ids) return;
    let stopped = false;
    let timer = 0;
    const check = async (state: PollState) => {
      const results = await Promise.all(ids.split(',').map((id) => getFileStatus(id).catch(() => null)));
      if (stopped) return;
      const step = pollStep(state, combinedStatus(results.map((r) => (r?.ok ? r.data : null))), Date.now());
      if (step.refresh) router.refresh();
      if (step.next) {
        const next = step.next;
        timer = window.setTimeout(() => void check(next), next.delay);
      }
    };
    const first = startPoll(Date.now());
    timer = window.setTimeout(() => void check(first), first.delay);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [active, ids, router]);
  return null;
}

/** "Extract pages": read a page range (a textbook chapter) of a stored PDF. */
export function ExtractPagesForm({ documentId, pageCount, aiOn }: { documentId: string; pageCount: number; aiOn: boolean }) {
  const router = useRouter();
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState(String(Math.min(pageCount, 20)));
  const [isPending, startTransition] = useTransition();
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const res = await extractPages({ documentId, from: Number(from), to: Number(to) });
          if (!res.ok) toast.error(res.error);
          else {
            toast.success(`Reading pages ${from} to ${to}`);
            router.refresh();
          }
        });
      }}
    >
      <p className="text-sm text-muted-foreground">
        Read a chapter: its text becomes searchable and citable in Ask.{' '}
        {aiOn ? 'Pages with no text layer are transcribed by Claude.' : 'AI is off for this course, so only pages with a text layer are read.'}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">
          <span className="font-semibold">From page</span>
          <Input type="number" min={1} max={pageCount} value={from} onChange={(e) => setFrom(e.target.value)} className="h-11 w-28 sm:h-9" required />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-semibold">To page</span>
          <Input type="number" min={1} max={pageCount} value={to} onChange={(e) => setTo(e.target.value)} className="h-11 w-28 sm:h-9" required />
        </label>
        <Button type="submit" className="h-11 sm:h-9" disabled={isPending}>
          {isPending ? 'Starting' : 'Extract pages'}
        </Button>
      </div>
    </form>
  );
}

export function RetryPagesButton({ documentId, count }: { documentId: string; count: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      className="h-11 sm:h-8"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const res = await retryFailedPages(documentId);
          if (!res.ok) toast.error(res.error);
          else router.refresh();
        })
      }
    >
      {count === 1 ? 'Try the failed page again' : `Try the ${count} failed pages again`}
    </Button>
  );
}
