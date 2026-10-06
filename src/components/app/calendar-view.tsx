'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import { formatDate, type EventApi, type EventContentArg, type EventInput, type EventMountArg, type MoreLinkArg, type MoreLinkSimpleAction } from '@fullcalendar/core';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { ItemKind } from '@/config/term-f26';
import { EXAM_KINDS, ITEM_KINDS, KIND_LABEL } from '@/lib/items/labels';
import { runwayState } from '@/lib/items/runway';
import { fitTimedEvent, toTorontoDate, toTorontoTime } from '@/lib/time';
import { selectClass } from '@/lib/ui';
import { cn } from '@/lib/utils';
import { courseStyle } from './course-mark';
import { useShell } from './shell-provider';

export interface CalendarItem {
  id: string;
  course_id: string | null;
  kind: string;
  title: string;
  due_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  all_day: boolean;
  time_known: boolean;
  progress: string;
  prep_days: number | null;
  location: string | null;
  seat: string | null;
}

export interface CalendarReminder {
  id: string;
  course_id: string | null;
  item_id: string | null;
  title: string;
  remind_at: string;
}

const VIEWS = ['dayGridMonth', 'timeGridWeek', 'timeGridDay', 'listWeek'] as const;
type View = (typeof VIEWS)[number];
const VIEW_KEY = 'runway.calendarView';
const NARROW = '(max-width: 639px)';
const TIME_FORMAT = { hour: 'numeric', minute: '2-digit', meridiem: 'short' } as const;
/**
 * FullCalendar opens its own popover when moreLinkClick returns nothing or "popover", and
 * switches view for any other string. Any other truthy value does neither, so Runway's list
 * opens alone.
 */
const KEEP_POPOVER_CLOSED = true as unknown as MoreLinkSimpleAction;

interface EventProps {
  itemId?: string;
  color?: string;
  colorDark?: string;
  /**
   * Set for deadlines and short events drawn one slot tall: the real start, which the box
   * shows as its only time (it may have moved up to stay inside its day).
   */
  realStart?: string;
}

/** One row in the "+N more" list. */
interface MoreRow {
  id: string;
  title: string;
  time: string;
}

const titleObservers = new WeakMap<HTMLElement, ResizeObserver>();

function eventTime(event: EventApi): string {
  if (event.allDay || !event.start) return 'All day';
  const { realStart } = event.extendedProps as EventProps;
  return formatDate(realStart ?? event.start, TIME_FORMAT);
}

function moreRow(event: EventApi): MoreRow {
  return { id: event.id, title: event.title, time: eventTime(event) };
}

/**
 * Week and day columns wrap event titles. Clamp them to the whole lines that fit in the
 * event's box (globals.css turns --title-lines into a line clamp with an ellipsis), so the
 * last visible line is never cut through the middle. Re-measured when the box resizes.
 */
function clampTitle(el: HTMLElement) {
  const measure = () => {
    const box = el.querySelector<HTMLElement>('.fc-event-title-container');
    const title = el.querySelector<HTMLElement>('.fc-event-title');
    if (!box || !title) return;
    const line = parseFloat(getComputedStyle(title).lineHeight) || 16;
    el.style.setProperty('--title-lines', String(Math.max(1, Math.floor(box.clientHeight / line))));
  };
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(el);
  titleObservers.set(el, observer);
}

function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

export function CalendarView({ items, reminders }: { items: CalendarItem[]; reminders: CalendarReminder[] }) {
  const { courses, openItem, openQuickAdd } = useShell();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const calendar = useRef<FullCalendar>(null);
  const [view, setView] = useState<View | null>(null);
  const [narrow, setNarrow] = useState(false);
  const [more, setMore] = useState<{ heading: string; rows: MoreRow[] } | null>(null);

  const coursesParam = params.get('courses') ?? '';
  const selectedSlugs = coursesParam.split(',').filter(Boolean);
  const kind = params.get('kind') ?? '';
  const showPrep = params.get('prep') !== '0';
  const showReminders = params.get('reminders') !== '0';
  const courseBySlug = useMemo(() => new Map(courses.map((c) => [c.slug, c])), [courses]);
  const courseById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);

  useEffect(() => {
    const saved = localStorage.getItem(VIEW_KEY) as View | null;
    const fallback: View = window.matchMedia('(min-width: 640px)').matches ? 'timeGridWeek' : 'listWeek';
    // The saved view lives in localStorage, which only exists after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setView(saved && VIEWS.includes(saved) ? saved : fallback);
  }, []);

  useEffect(() => {
    const query = window.matchMedia(NARROW);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const api = calendar.current?.getApi();
      if (!api) return;
      if (e.key === 't') api.today();
      else if (e.key === 'ArrowLeft') api.prev();
      else if (e.key === 'ArrowRight') api.next();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function toggleCourse(slug: string) {
    const set = new Set(selectedSlugs);
    if (set.has(slug)) set.delete(slug);
    else set.add(slug);
    setParam('courses', [...set].join(','));
  }

  function buildEvents(): EventInput[] {
    const now = new Date();
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    /** Deadlines and short events get one slot of height and stay inside their own day. */
    const timed = (start: string, end: string | null) => {
      const fit = fitTimedEvent(new Date(start), end ? new Date(end) : null, zone);
      return {
        start: fit.start.toISOString(),
        end: fit.end.toISOString(),
        realStart: fit.adjusted ? start : undefined,
      };
    };
    const selectedIds = new Set(
      coursesParam
        .split(',')
        .map((s) => courseBySlug.get(s)?.id)
        .filter(Boolean),
    );
    const out: EventInput[] = [];
    for (const item of items) {
      if (selectedIds.size && (!item.course_id || !selectedIds.has(item.course_id))) continue;
      if (kind && item.kind !== kind) continue;
      const at = item.due_at ?? item.starts_at;
      if (!at) continue;
      const course = item.course_id ? courseById.get(item.course_id) : null;
      const k = item.kind as ItemKind;
      const label = `${course ? `${course.code} ` : ''}${item.title}${item.time_known ? '' : ' (time TBD)'}`;
      const done = item.progress === 'submitted' || item.progress === 'graded';
      const base = {
        extendedProps: { itemId: item.id, color: course?.color, colorDark: course?.color_dark },
      };

      if (item.all_day && item.ends_at && (k === 'break' || k === 'admin')) {
        out.push({
          ...base,
          id: `bg-${item.id}`,
          start: toTorontoDate(new Date(item.starts_at ?? at)),
          end: toTorontoDate(new Date(item.ends_at)),
          allDay: true,
          display: 'background',
          title: item.title,
          classNames: ['runway-break', 'hatch'],
        });
        continue;
      }

      const start = item.starts_at ?? at;
      const classNames = ['runway-event', EXAM_KINDS.includes(k) ? 'runway-exam' : ''];
      const title = `${done ? '✓ ' : ''}${label}`;
      if (item.time_known) {
        const fit = timed(start, item.ends_at);
        out.push({
          id: item.id,
          title,
          start: fit.start,
          end: fit.end,
          extendedProps: { ...base.extendedProps, realStart: fit.realStart },
          classNames,
        });
      } else {
        out.push({ ...base, id: item.id, title, start: toTorontoDate(new Date(at)), allDay: true, classNames });
      }

      if (showPrep && !done) {
        const state = runwayState({ ...item, kind: k, courseSlug: course?.slug ?? null }, now);
        if (state.start && state.prepDays > 0 && !EXAM_KINDS.includes(k)) {
          out.push({
            ...base,
            id: `prep-${item.id}`,
            title: `Prep: ${label}`,
            start: toTorontoDate(state.start),
            allDay: true,
            classNames: ['runway-event', 'hatch', 'opacity-70'],
          });
        }
      }
    }
    if (showReminders) {
      for (const r of reminders) {
        if (selectedIds.size && (!r.course_id || !selectedIds.has(r.course_id))) continue;
        const fit = timed(r.remind_at, null);
        out.push({
          id: `rem-${r.id}`,
          title: r.title,
          start: fit.start,
          end: fit.end,
          extendedProps: { itemId: r.item_id ?? undefined, realStart: fit.realStart },
          classNames: ['runway-reminder', 'text-muted-foreground'],
          backgroundColor: 'transparent',
          borderColor: 'transparent',
        });
      }
    }
    return out;
  }
  const events = buildEvents();

  function onMount(arg: EventMountArg) {
    const { color, colorDark, realStart } = arg.event.extendedProps as EventProps;
    arg.el.setAttribute('data-course', '');
    if (color) arg.el.style.setProperty('--course-l', color);
    if (colorDark) arg.el.style.setProperty('--course-d', colorDark);
    // Titles can be cut short in narrow columns; hovering shows the whole thing.
    const time = realStart ? eventTime(arg.event) : arg.timeText;
    arg.el.title = time ? `${time} ${arg.event.title}` : arg.event.title;
    if (arg.el.classList.contains('fc-timegrid-event')) clampTitle(arg.el);
  }

  /** A one-slot box shows its real start alone (11:59pm, not 11:30pm - 12:00am). */
  function renderContent(arg: EventContentArg) {
    const { realStart } = arg.event.extendedProps as EventProps;
    if (!realStart || !arg.timeText) return true;
    return (
      <div className="fc-event-main-frame">
        <div className="fc-event-time">{eventTime(arg.event)}</div>
        <div className="fc-event-title-container">
          <div className="fc-event-title fc-sticky">{arg.event.title}</div>
        </div>
      </div>
    );
  }

  function openEvent(event: EventApi) {
    const { itemId } = event.extendedProps as EventProps;
    if (itemId) openItem(itemId);
    else if (event.id.startsWith('rem-')) router.push('/inbox#paste-reminders');
  }

  /** "+N more" opens one list of everything sharing that slot (or day), the visible ones included. */
  function onMoreLink(arg: MoreLinkArg) {
    let events = arg.allSegs.map((s) => s.event);
    if (!arg.allDay && arg.view.type.startsWith('timeGrid')) {
      const hidden = arg.hiddenSegs.map((s) => s.event);
      const from = Math.min(...hidden.map((e) => e.start?.getTime() ?? Infinity));
      const to = Math.max(...hidden.map((e) => e.end?.getTime() ?? e.start?.getTime() ?? -Infinity));
      events = (calendar.current?.getApi().getEvents() ?? []).filter(
        (e) => !e.allDay && e.display !== 'background' && e.start && e.end && e.start.getTime() < to && e.end.getTime() > from,
      );
    }
    events.sort((a, b) => (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0) || a.title.localeCompare(b.title));
    setMore({ heading: formatDate(arg.date, { weekday: 'long', month: 'short', day: 'numeric' }), rows: events.map(moreRow) });
    return KEEP_POPOVER_CLOSED;
  }

  function onUnmount(arg: EventMountArg) {
    titleObservers.get(arg.el)?.disconnect();
    titleObservers.delete(arg.el);
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {courses.map((c) => {
          const active = selectedSlugs.includes(c.slug);
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={active}
              onClick={() => toggleCourse(c.slug)}
              data-course=""
              style={courseStyle(c)}
              className={cn(
                'inline-flex h-11 items-center gap-1.5 rounded-full border px-3 text-sm sm:h-9',
                active ? 'border-(--course) bg-[color-mix(in_oklab,var(--course)_14%,transparent)] font-semibold' : 'border-rule',
              )}
            >
              <span aria-hidden className="size-2 rounded-full bg-(--course)" />
              {c.code}
            </button>
          );
        })}
        {selectedSlugs.length ? (
          <button type="button" className="h-11 px-2 text-sm text-link sm:h-9" onClick={() => setParam('courses', null)}>
            All courses
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">
          <span className="font-semibold">Kind</span>
          <select className={cn(selectClass, 'w-40')} value={kind} onChange={(e) => setParam('kind', e.target.value)}>
            <option value="">All kinds</option>
            {ITEM_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex h-11 items-center gap-2 text-sm sm:h-9">
          <input type="checkbox" className="size-4 accent-(--mark)" checked={showPrep} onChange={(e) => setParam('prep', e.target.checked ? null : '0')} />
          Prep blocks
        </label>
        <label className="flex h-11 items-center gap-2 text-sm sm:h-9">
          <input type="checkbox" className="size-4 accent-(--mark)" checked={showReminders} onChange={(e) => setParam('reminders', e.target.checked ? null : '0')} />
          Reminders
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-semibold">Jump to</span>
          <Input
            type="date"
            className="h-11 w-44 sm:h-9"
            onChange={(e) => {
              if (e.target.value) calendar.current?.getApi().gotoDate(e.target.value);
            }}
          />
        </label>
      </div>

      {view ? (
        <FullCalendar
          ref={calendar}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView={view}
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek' }}
          buttonText={{ today: 'Today', month: 'Month', week: 'Week', day: 'Day', list: 'List' }}
          firstDay={1}
          height="auto"
          nowIndicator
          allDayText="All day"
          scrollTime="08:00:00"
          slotMinTime="07:00:00"
          eventTimeFormat={TIME_FORMAT}
          noEventsText="Nothing scheduled. Click a day to add an item."
          events={events}
          slotEventOverlap={false}
          eventMaxStack={narrow ? 1 : 3}
          dayMaxEvents={narrow ? 2 : 4}
          moreLinkContent={(arg) => `+${arg.num} more`}
          moreLinkClick={onMoreLink}
          eventContent={renderContent}
          eventDidMount={onMount}
          eventWillUnmount={onUnmount}
          datesSet={(arg) => localStorage.setItem(VIEW_KEY, arg.view.type)}
          eventClick={(arg) => openEvent(arg.event)}
          dateClick={(arg) => {
            const date = arg.allDay ? arg.dateStr.slice(0, 10) : toTorontoDate(arg.date);
            openQuickAdd({ date, time: arg.allDay ? undefined : toTorontoTime(arg.date) });
          }}
          fixedWeekCount={false}
        />
      ) : (
        <div className="h-96" aria-busy />
      )}
      <Dialog open={more !== null} onOpenChange={(open) => !open && setMore(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{more?.heading}</DialogTitle>
            <DialogDescription>{more ? `${more.rows.length} items. Choose one to open it.` : null}</DialogDescription>
          </DialogHeader>
          <ul className="grid divide-y divide-rule">
            {more?.rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className="grid min-h-11 w-full grid-cols-[5.5rem_1fr] items-baseline gap-2 py-2 text-left text-sm hover:bg-[color-mix(in_oklab,var(--rule)_40%,transparent)]"
                  onClick={() => {
                    setMore(null);
                    const event = calendar.current?.getApi().getEventById(row.id);
                    if (event) openEvent(event);
                  }}
                >
                  <span className="text-muted-foreground tabular-nums">{row.time}</span>
                  <span className="min-w-0 break-words">{row.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
      <p className="text-xs text-muted-foreground">
        Times shown in your device&apos;s time zone. Items without a time show as all day with &quot;(time TBD)&quot;.
      </p>
    </div>
  );
}
