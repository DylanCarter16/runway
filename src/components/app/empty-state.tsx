import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Centered message that says what to do next, with the action beside it. */
export function EmptyState({ title, children, action, className }: { title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('grid justify-items-center gap-3 border border-dashed border-rule px-6 py-10 text-center', className)}>
      <p className="font-semibold">{title}</p>
      {children ? <div className="max-w-md text-sm text-muted-foreground">{children}</div> : null}
      {action}
    </div>
  );
}
