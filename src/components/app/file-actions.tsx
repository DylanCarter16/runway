'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { extractPages, retryFailedPages } from '@/app/(app)/files/actions';

/** Reloads the page every few seconds while a file is still being read. */
export function RefreshWhileReading({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => router.refresh(), 4000);
    return () => window.clearInterval(t);
  }, [active, router]);
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
