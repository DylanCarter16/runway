import { CheckIcon } from 'lucide-react';
import type { RunwayState } from '@/lib/items/runway';
import { formatListDate } from '@/lib/time';
import { cn } from '@/lib/utils';

const HEIGHT = { row: 'h-1', table: 'h-0.5', drawer: 'h-1.5' } as const;

/**
 * The prep window under a deadline: a track from runway start to due, filled
 * up to now in the course color, with a "now" tick. See docs/DESIGN.md.
 */
export function RunwayBar({
  state,
  size = 'row',
  showDates = false,
  className,
}: {
  state: RunwayState;
  size?: keyof typeof HEIGHT;
  showDates?: boolean;
  className?: string;
}) {
  if (!state.start || !state.due) return null;
  if (state.status === 'none' && state.prepDays === 0) return null;

  if (state.status === 'upcoming') {
    return (
      <div className={cn('flex items-center gap-3', className)}>
        <div role="img" aria-label={state.label} className={cn('flex-1 rounded-full bg-rule', HEIGHT[size])} />
        <span className="shrink-0 text-xs text-muted-foreground tabular">Prep starts {formatListDate(state.start)}</span>
      </div>
    );
  }

  if (state.status === 'submitted') {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <div
          role="img"
          aria-label="Submitted"
          className={cn('flex-1 border-t-2 border-dotted border-graphite transition-all duration-200')}
        />
        <CheckIcon className="size-4 text-graphite" aria-hidden />
      </div>
    );
  }

  const fill =
    state.status === 'overdue' ? 'bg-late' : state.status === 'soon' ? 'bg-soon' : 'bg-(--course)';
  const pct = `${Math.round(state.fraction * 100)}%`;

  return (
    <div className={className}>
      <div role="img" aria-label={state.label} className={cn('relative w-full rounded-full bg-rule', HEIGHT[size])}>
        <div className={cn('absolute inset-y-0 left-0 rounded-full', fill)} style={{ width: pct }} />
        {state.status !== 'overdue' ? (
          <div
            className="absolute top-1/2 h-2.5 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-mark"
            style={{ left: pct }}
          />
        ) : null}
      </div>
      {showDates ? (
        <div className="mt-1 flex justify-between text-xs text-muted-foreground tabular">
          <span>Prep from {formatListDate(state.start)}</span>
          <span>Due {formatListDate(state.due)}</span>
        </div>
      ) : null}
    </div>
  );
}
