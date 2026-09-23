'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CalendarDaysIcon,
  ClipboardPasteIcon,
  InboxIcon,
  LibraryIcon,
  MenuIcon,
  MessageCircleQuestionIcon,
  NotebookIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { courseStyle } from './course-mark';
import { useShell } from './shell-provider';

const MAIN = [
  { href: '/', label: 'Today', icon: SunIcon },
  { href: '/calendar', label: 'Calendar', icon: CalendarDaysIcon },
  { href: '/inbox', label: 'Inbox', icon: InboxIcon },
  { href: '/notes', label: 'Notes', icon: NotebookIcon },
  { href: '/ask', label: 'Ask', icon: MessageCircleQuestionIcon },
  { href: '/library', label: 'Library', icon: LibraryIcon },
];

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

const ICON = 'size-[18px] shrink-0 stroke-[1.75]';

/** Desktop left rail (232px), icons only on tablets. */
export function Rail({ inboxCount }: { inboxCount: number }) {
  const pathname = usePathname();
  const { courses } = useShell();

  const link = (href: string, label: string, Icon: typeof SunIcon, extra?: React.ReactNode) => {
    const active = isActive(pathname, href);
    return (
      <Tooltip key={href}>
        <TooltipTrigger
          render={
            <Link
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex h-10 items-center gap-3 rounded-md px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground',
                'sm:max-lg:justify-center sm:max-lg:px-0',
                active && 'bg-muted font-semibold text-foreground',
              )}
            />
          }
        >
          <Icon className={ICON} aria-hidden />
          <span className="sm:max-lg:sr-only">{label}</span>
          {extra}
        </TooltipTrigger>
        <TooltipContent side="right" className="lg:hidden">
          {label}
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
    <nav
      aria-label="Main"
      className="sticky top-0 hidden h-dvh shrink-0 flex-col gap-1 overflow-y-auto border-r border-rule bg-paper p-3 sm:flex sm:w-16 lg:w-58"
    >
      <Link href="/" className="mb-3 flex h-10 items-center px-3 text-lg font-semibold sm:max-lg:justify-center sm:max-lg:px-0">
        <span className="sm:max-lg:hidden">Runway</span>
        <span className="lg:hidden" aria-hidden>
          R
        </span>
      </Link>
      {MAIN.map((m) =>
        link(
          m.href,
          m.label,
          m.icon,
          m.href === '/inbox' && inboxCount > 0 ? (
            <span className="ml-auto text-xs font-semibold tabular sm:max-lg:hidden">{inboxCount}</span>
          ) : null,
        ),
      )}

      <div className="mt-5 mb-1 px-3 text-xs text-muted-foreground sm:max-lg:sr-only">
        <Link href="/courses" className="hover:text-foreground">
          Courses
        </Link>
      </div>
      {courses.map((c) => {
        const href = `/courses/${c.slug}`;
        const active = isActive(pathname, href);
        return (
          <Tooltip key={c.id}>
            <TooltipTrigger
              render={
                <Link
                  href={`${href}/overview`}
                  aria-current={active ? 'page' : undefined}
                  data-course=""
                  style={courseStyle(c)}
                  className={cn(
                    'flex h-10 items-center gap-3 rounded-md px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground',
                    'sm:max-lg:justify-center sm:max-lg:px-0',
                    active && 'bg-muted font-semibold text-foreground',
                  )}
                />
              }
            >
              <span aria-hidden className="h-5 w-1 shrink-0 rounded-full bg-(--course)" />
              <span className="sm:max-lg:sr-only">{c.code}</span>
            </TooltipTrigger>
            <TooltipContent side="right" className="lg:hidden">
              {c.code}
            </TooltipContent>
          </Tooltip>
        );
      })}

      <div className="mt-auto pt-4">{link('/settings/term', 'Settings', SettingsIcon)}</div>
    </nav>
  );
}

const TITLES: [string, string][] = [
  ['/calendar', 'Calendar'],
  ['/inbox', 'Inbox'],
  ['/courses', 'Courses'],
  ['/notes', 'Notes'],
  ['/ask', 'Ask'],
  ['/library', 'Library'],
  ['/items', 'Item'],
  ['/search', 'Search'],
  ['/settings', 'Settings'],
];

/** Top bar: search field and Paste on desktop; title, search icon, and More on mobile. */
export function TopBar() {
  const pathname = usePathname();
  const { openPalette, openQuickAdd, courses } = useShell();
  const course = courses.find((c) => pathname.startsWith(`/courses/${c.slug}`));
  const title = course?.code ?? TITLES.find(([p]) => pathname.startsWith(p))?.[1] ?? 'Today';

  return (
    <header className="sticky top-0 z-30 border-b border-rule bg-paper/95 backdrop-blur supports-backdrop-filter:bg-paper/80">
      <div className="flex h-14 items-center gap-2 px-4 sm:px-6">
        <h1 className="text-lg font-semibold sm:hidden">{title}</h1>
        <button
          type="button"
          onClick={openPalette}
          className="hidden h-9 max-w-md flex-1 items-center gap-2 rounded-md border border-rule bg-sheet px-3 text-sm text-muted-foreground hover:text-foreground sm:flex"
        >
          <SearchIcon className={ICON} aria-hidden />
          Search everything
          <span className="ml-auto text-xs">Ctrl K</span>
        </button>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <Button variant="ghost" size="icon-lg" className="size-11 sm:hidden" aria-label="Search" onClick={openPalette}>
            <SearchIcon className={ICON} />
          </Button>
          <Button variant="outline" className="hidden h-9 sm:inline-flex" onClick={() => openQuickAdd()}>
            <PlusIcon className={ICON} /> Add item
          </Button>
          <Link href="/inbox" className={cn(buttonVariants(), 'hidden h-9 sm:inline-flex')}>
            <ClipboardPasteIcon className={ICON} /> Paste
          </Link>
          <MoreMenu />
        </div>
      </div>
      <CourseChips />
    </header>
  );
}

function MoreMenu() {
  const { openQuickAdd } = useShell();
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="ghost" size="icon-lg" className="size-11 sm:hidden" aria-label="More" />}>
        <MenuIcon className={ICON} />
      </SheetTrigger>
      <SheetContent side="right" className="w-72">
        <SheetHeader>
          <SheetTitle>More</SheetTitle>
        </SheetHeader>
        <div className="grid gap-1 px-2">
          <Button variant="ghost" className="h-11 justify-start" onClick={() => openQuickAdd()}>
            <PlusIcon className={ICON} /> Add item
          </Button>
          <Link href="/courses" className={cn(buttonVariants({ variant: 'ghost' }), 'h-11 justify-start')}>
            Courses
          </Link>
          <Link href="/library" className={cn(buttonVariants({ variant: 'ghost' }), 'h-11 justify-start')}>
            <LibraryIcon className={ICON} /> Library
          </Link>
          <Link href="/settings/term" className={cn(buttonVariants({ variant: 'ghost' }), 'h-11 justify-start')}>
            <SettingsIcon className={ICON} /> Settings
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Scrolling row of course chips under the mobile header. */
function CourseChips() {
  const { courses } = useShell();
  const pathname = usePathname();
  if (!courses.length) return null;
  return (
    <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-2 sm:hidden">
      {courses.map((c) => {
        const active = pathname.startsWith(`/courses/${c.slug}`);
        return (
          <Link
            key={c.id}
            href={`/courses/${c.slug}/overview`}
            data-course=""
            style={courseStyle(c)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-rule bg-[color-mix(in_oklab,var(--course)_12%,transparent)] px-3 text-sm',
              active && 'border-(--course) font-semibold',
            )}
          >
            <span aria-hidden className="size-2 rounded-full bg-(--course)" />
            {c.code}
          </Link>
        );
      })}
    </div>
  );
}

/** Mobile bottom bar: Today, Calendar, Paste (center), Notes, Ask. */
export function BottomBar() {
  const pathname = usePathname();
  const items = [
    { href: '/', label: 'Today', icon: SunIcon },
    { href: '/calendar', label: 'Calendar', icon: CalendarDaysIcon },
    { href: '/inbox', label: 'Paste', icon: ClipboardPasteIcon, center: true },
    { href: '/notes', label: 'Notes', icon: NotebookIcon },
    { href: '/ask', label: 'Ask', icon: MessageCircleQuestionIcon },
  ];
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-rule bg-paper pb-[env(safe-area-inset-bottom)] sm:hidden"
    >
      {items.map(({ href, label, icon: Icon, center }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs',
              active ? 'font-semibold text-foreground' : 'text-muted-foreground',
            )}
          >
            {center ? (
              <span className="flex size-9 items-center justify-center rounded-full bg-tie text-on-tie">
                <Icon className={ICON} aria-hidden />
              </span>
            ) : (
              <Icon className={ICON} aria-hidden />
            )}
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
