'use client';

import Link from 'next/link';
import { useSelectedLayoutSegment } from 'next/navigation';
import { cn } from '@/lib/utils';

export const COURSE_TABS = [
  ['overview', 'Overview'],
  ['deadlines', 'Deadlines'],
  ['notes', 'Notes'],
  ['ask', 'Ask'],
  ['resources', 'Resources'],
  ['updates', 'Updates'],
  ['grades', 'Grades'],
  ['library', 'Library'],
] as const;

export function CourseTabs({ slug }: { slug: string }) {
  const segment = useSelectedLayoutSegment();
  return (
    <nav aria-label="Course sections" className="no-scrollbar -mx-4 flex overflow-x-auto border-b border-rule px-4 sm:mx-0 sm:px-0">
      {COURSE_TABS.map(([tab, label]) => {
        const active = segment === tab;
        return (
          <Link
            key={tab}
            href={`/courses/${slug}/${tab}`}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex min-h-11 shrink-0 items-center px-3 text-sm text-muted-foreground hover:text-foreground',
              active && 'font-semibold text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-tie',
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
