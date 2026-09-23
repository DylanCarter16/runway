import Link from 'next/link';
import type { ThreadRow } from '@/lib/ask/options';
import { scopeLabel, type ScopeOptions } from '@/lib/ask/scope';
import { formatAgo } from '@/lib/time';
import { cn } from '@/lib/utils';

/** Saved Ask threads, newest first (SPEC 4.6). */
export function AskThreads({ threads, options, activeId, now }: { threads: ThreadRow[]; options: ScopeOptions; activeId?: string; now: Date }) {
  if (!threads.length) return <p className="text-sm text-muted-foreground">No saved questions yet.</p>;
  return (
    <ul className="divide-y divide-rule border-y border-rule">
      {threads.map((t) => (
        <li key={t.id}>
          <Link
            href={`/ask/${t.id}`}
            aria-current={t.id === activeId ? 'page' : undefined}
            className={cn('grid min-h-11 gap-0.5 px-2 py-2 hover:bg-sheet', t.id === activeId && 'bg-sheet')}
          >
            <span className="line-clamp-2 text-sm font-semibold">{t.title}</span>
            <span className="text-xs text-muted-foreground">
              {scopeLabel(t.scope, options)}, {formatAgo(new Date(t.updatedAt), now)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
