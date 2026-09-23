'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { setHybridSearch } from '@/app/(app)/settings/actions';

/** Settings, AI: turn hybrid search on or off, and how many passages have embeddings. */
export function HybridSearchControls({ configured, on, total, embedded }: { configured: boolean; on: boolean; total: number; embedded: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function set(next: boolean) {
    startTransition(async () => {
      const result = await setHybridSearch({ on: next });
      if (!result.ok) toast.error(result.error);
      else {
        toast.success(next ? 'Hybrid search on' : 'Hybrid search off');
        router.refresh();
      }
    });
  }

  if (!configured) {
    return (
      <p className="max-w-2xl text-sm">
        Not set up: add <code className="font-mono text-xs">VOYAGE_API_KEY</code> in Vercel (docs/BLOCKED.md). Until then Ask searches by words only.
      </p>
    );
  }

  const waiting = total - embedded;
  return (
    <div className="grid gap-2">
      <p className="text-sm">
        {on ? 'On. ' : 'Off. '}
        {total === 0
          ? 'No passages from courses with AI on yet.'
          : `${embedded.toLocaleString()} of ${total.toLocaleString()} passages have embeddings${on && waiting > 0 ? '; the rest are on their way' : ''}.`}
      </p>
      <div>
        {on ? (
          <Button variant="outline" className="h-11 sm:h-9" disabled={isPending} onClick={() => set(false)}>
            Turn off hybrid search
          </Button>
        ) : (
          <Button className="h-11 sm:h-9" disabled={isPending} onClick={() => set(true)}>
            {isPending ? 'Turning on' : 'Turn on hybrid search'}
          </Button>
        )}
      </div>
    </div>
  );
}
