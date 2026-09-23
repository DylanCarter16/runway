'use client';

import { useOptimistic, useTransition } from 'react';
import { toast } from 'sonner';
import { setProgress } from '@/app/(app)/actions';
import { PROGRESS_LABEL, type Progress } from '@/lib/items/labels';
import { cn } from '@/lib/utils';

/** Tells an open item drawer to reload after a change. */
export function notifyItemChanged() {
  window.dispatchEvent(new Event('runway:item-changed'));
}

const OPTIONS: Progress[] = ['todo', 'started', 'submitted'];

/** Todo, Started, Submitted as a segmented radio group. */
export function ProgressControl({ itemId, progress, compact = false }: { itemId: string; progress: string; compact?: boolean }) {
  const [value, setValue] = useOptimistic(progress);
  const [, startTransition] = useTransition();

  function choose(next: Progress) {
    if (next === value) return;
    startTransition(async () => {
      setValue(next);
      const result = await setProgress(itemId, next);
      if (!result.ok) toast.error(result.error);
      else {
        if (next === 'submitted') toast.success('Marked submitted');
        notifyItemChanged();
      }
    });
  }

  return (
    <div role="radiogroup" aria-label="Progress" className="inline-flex rounded-md border border-rule bg-sheet p-0.5">
      {OPTIONS.map((p) => {
        const active = value === p || (p === 'submitted' && value === 'graded');
        return (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={(e) => {
              e.stopPropagation();
              choose(p);
            }}
            className={cn(
              'min-h-11 rounded-sm px-2.5 text-sm sm:min-h-8',
              compact && 'px-2 text-xs',
              active ? 'bg-ink text-paper font-semibold' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {p === 'submitted' && value === 'graded' ? PROGRESS_LABEL.graded : PROGRESS_LABEL[p]}
          </button>
        );
      })}
    </div>
  );
}
