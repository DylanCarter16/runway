'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { loadTermSetup } from '@/app/(app)/actions';
import { SETTINGS_SECTIONS } from '@/lib/ui';
import { cn } from '@/lib/utils';


export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings sections" className="no-scrollbar -mx-4 flex overflow-x-auto border-b border-rule px-4 sm:mx-0 sm:px-0">
      {SETTINGS_SECTIONS.map(([id, label]) => {
        const active = pathname === `/settings/${id}`;
        return (
          <Link
            key={id}
            href={`/settings/${id}`}
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

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // next-themes only knows the theme after mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);
  const options: [string, string][] = [
    ['system', 'Match system'],
    ['light', 'Light'],
    ['dark', 'Dark'],
  ];
  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-md border border-rule bg-sheet p-0.5">
      {options.map(([value, label]) => {
        const active = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(value)}
            className={cn('min-h-11 rounded-sm px-3 text-sm sm:min-h-8', active ? 'bg-ink font-semibold text-paper' : 'text-muted-foreground hover:text-foreground')}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function LoadTermButton() {
  const [isPending, startTransition] = useTransition();
  const [summary, setSummary] = useState<string | null>(null);
  return (
    <div className="grid gap-2">
      <div>
        <Button
          className="h-11 sm:h-9"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await loadTermSetup();
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              const { created: c, updated: u } = result.data;
              const added = c.courses + c.links + c.pages + c.items;
              const parts = [];
              if (added) parts.push(`Added ${c.courses} courses, ${c.items} items, ${c.links} links, and ${c.pages} watched pages.`);
              if (u.items || u.courses) parts.push(`Updated ${u.items} items and the class times of ${u.courses} courses.`);
              setSummary(parts.length ? parts.join(' ') : 'Already up to date. Nothing changed.');
              toast.success('Loaded');
            })
          }
        >
          {isPending ? 'Loading' : 'Load Fall 2026 setup'}
        </Button>
      </div>
      {summary ? (
        <p role="status" className="text-sm">
          {summary}
        </p>
      ) : null}
    </div>
  );
}
