'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarIcon, FileTextIcon, LinkIcon, NotebookIcon, SearchIcon, SquareCheckIcon } from 'lucide-react';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { search, type SearchHit } from '@/app/(app)/actions';
import { formatListDate } from '@/lib/time';
import { CourseDot } from './course-mark';
import { useShell } from './shell-provider';

const PAGES = [
  { label: 'Today', href: '/' },
  { label: 'Calendar', href: '/calendar' },
  { label: 'Inbox', href: '/inbox' },
  { label: 'Courses', href: '/courses' },
  { label: 'Notes', href: '/notes' },
  { label: 'Ask', href: '/ask' },
  { label: 'Library', href: '/library' },
  { label: 'Settings', href: '/settings/term' },
  { label: 'Settings, sync', href: '/settings/sync' },
];

const TYPE_LABEL: Record<SearchHit['type'], string> = {
  item: 'Items',
  note: 'Notes',
  document: 'Documents',
  link: 'Links',
};

const TYPE_ICON = {
  item: SquareCheckIcon,
  note: NotebookIcon,
  document: FileTextIcon,
  link: LinkIcon,
};

interface Recent {
  id: string;
  title: string;
  courseId: string | null;
}

function readStore<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]') as T[];
  } catch {
    return [];
  }
}

function pushStore<T>(key: string, value: T, same: (a: T) => boolean) {
  const list = [value, ...readStore<T>(key).filter((v) => !same(v))].slice(0, 6);
  localStorage.setItem(key, JSON.stringify(list));
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { courses, openItem } = useShell();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [recentItems, setRecentItems] = useState<Recent[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const courseById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);

  useEffect(() => {
    if (!open) return;
    // Recent lists live in localStorage, which only exists after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecentItems(readStore<Recent>('runway.recentItems'));
    setRecentSearches(readStore<string>('runway.recentSearches'));
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const timer = window.setTimeout(() => {
      startTransition(async () => {
        const result = await search(q, { limit: 30 });
        if (result.ok) {
          setHits(result.data);
          setError(null);
        } else {
          setError(result.error);
        }
      });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [query]);

  function close() {
    onOpenChange(false);
    setQuery('');
    setHits([]);
  }

  function remember() {
    const q = query.trim();
    if (q) pushStore('runway.recentSearches', q, (v) => v === q);
  }

  function choose(hit: SearchHit) {
    remember();
    close();
    if (hit.type === 'item') {
      pushStore<Recent>('runway.recentItems', { id: hit.id, title: hit.title, courseId: hit.courseId }, (v) => v.id === hit.id);
      openItem(hit.id);
    } else if (hit.type === 'note') router.push(`/notes/${hit.id}`);
    else if (hit.type === 'document') router.push(`/library/${hit.id}`);
    else if (hit.url) window.open(hit.url, '_blank', 'noopener,noreferrer');
  }

  function go(href: string) {
    remember();
    close();
    router.push(href);
  }

  const q = query.trim();
  const lower = q.toLowerCase();
  const pageHits = q ? PAGES.filter((p) => p.label.toLowerCase().includes(lower)) : [];
  const courseHits = q
    ? courses.filter((c) => c.code.toLowerCase().replace(' ', '').includes(lower.replace(' ', '')) || c.title.toLowerCase().includes(lower))
    : [];
  const groups = (['item', 'note', 'document', 'link'] as const)
    .map((type) => ({ type, hits: q ? hits.filter((h) => h.type === type) : [] }))
    .filter((g) => g.hits.length);

  return (
    <CommandDialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())} title="Search" description="Search items, notes, documents, links, and pages" className="sm:max-w-xl">
      <Command shouldFilter={false} loop>
        <CommandInput value={query} onValueChange={setQuery} placeholder="Search everything" aria-label="Search everything" />
        <CommandList className="max-h-[60vh]">
          {q && !isPending && !groups.length && !pageHits.length && !courseHits.length ? (
            <CommandEmpty>{error ?? `Nothing matches "${q}".`}</CommandEmpty>
          ) : null}

          {!q && recentItems.length ? (
            <CommandGroup heading="Recent items">
              {recentItems.map((r) => (
                <CommandItem
                  key={r.id}
                  value={`recent-${r.id}`}
                  onSelect={() => {
                    close();
                    openItem(r.id);
                  }}
                  className="min-h-11"
                >
                  <CourseDot course={r.courseId ? courseById.get(r.courseId) : null} />
                  <span className="truncate">{r.title}</span>
                  <span className="text-xs text-muted-foreground">{r.courseId ? courseById.get(r.courseId)?.code : ''}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {!q && recentSearches.length ? (
            <CommandGroup heading="Recent searches">
              {recentSearches.map((s) => (
                <CommandItem key={s} value={`search-${s}`} onSelect={() => setQuery(s)} className="min-h-11">
                  <SearchIcon />
                  {s}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {!q ? (
            <CommandGroup heading="Pages">
              {PAGES.slice(0, 8).map((p) => (
                <CommandItem key={p.href} value={`page-${p.href}`} onSelect={() => go(p.href)} className="min-h-11">
                  {p.label}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {courseHits.length ? (
            <CommandGroup heading="Courses">
              {courseHits.map((c) => (
                <CommandItem key={c.id} value={`course-${c.id}`} onSelect={() => go(`/courses/${c.slug}/overview`)} className="min-h-11">
                  <CourseDot course={c} />
                  {c.code}
                  <span className="text-muted-foreground">{c.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {groups.map((g) => (
            <CommandGroup key={g.type} heading={TYPE_LABEL[g.type]}>
              {g.hits.map((hit) => {
                const Icon = TYPE_ICON[hit.type];
                const course = hit.courseId ? courseById.get(hit.courseId) : null;
                return (
                  <CommandItem key={`${hit.type}-${hit.id}`} value={`${hit.type}-${hit.id}`} onSelect={() => choose(hit)} className="min-h-11 items-start">
                    <Icon className="mt-0.5 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <CourseDot course={course} />
                        <span className="truncate font-semibold">{hit.title}</span>
                      </div>
                      <div className="truncate text-xs text-muted-foreground tabular">
                        {[course?.code, hit.kind, hit.type !== 'link' && hit.at ? formatListDate(new Date(hit.at)) : null, hit.url ?? hit.snippet]
                          .filter(Boolean)
                          .join(', ')}
                      </div>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}

          {pageHits.length ? (
            <CommandGroup heading="Pages">
              {pageHits.map((p) => (
                <CommandItem key={p.href} value={`page-${p.href}`} onSelect={() => go(p.href)} className="min-h-11">
                  <CalendarIcon className="text-muted-foreground" />
                  {p.label}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {q ? (
            <CommandGroup>
              <CommandItem value="see-all" onSelect={() => go(`/search?q=${encodeURIComponent(q)}`)} className="min-h-11">
                <SearchIcon />
                See all results
              </CommandItem>
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
