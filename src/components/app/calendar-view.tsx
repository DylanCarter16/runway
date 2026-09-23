'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventInput, EventMountArg } from '@fullcalendar/core';
import { Input } from '@/components/ui/input';
import type { ItemKind } from '@/config/term-f26';
import { EXAM_KINDS, ITEM_KINDS, KIND_LABEL } from '@/lib/items/labels';
import { runwayState } from '@/lib/items/runway';
import { toTorontoDate, toTorontoTime } from '@/lib/time';
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
  title: string;
  remind_at: string;
}

const VIEWS = ['dayGridMonth', 'timeGridWeek', 'listWeek'] as const;
type View = (typeof VIEWS)[number];
const VIEW_KEY = 'runway.calendarView';

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
      out.push({
        ...base,
        id: item.id,
        title: `${done ? '✓ ' : ''}${label}`,
        start: item.time_known ? start : toTorontoDate(new Date(at)),
        end: item.time_known && item.ends_at ? item.ends_at : undefined,
        allDay: !item.time_known,
        classNames: ['runway-event', EXAM_KINDS.includes(k) ? 'runway-exam' : ''],
      });

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
        out.push({ id: `rem-${r.id}`, title: r.title, start: r.remind_at, classNames: ['text-muted-foreground'], backgroundColor: 'transparent', borderColor: 'transparent' });
      }
    }
    return out;
  }
  const events = buildEvents();

  function onMount(arg: EventMountArg) {
    const { color, colorDark } = arg.event.extendedProps as { color?: string; colorDark?: string };
    arg.el.setAttribute('data-course', '');
    if (color) arg.el.style.setProperty('--course-l', color);
    if (colorDark) arg.el.style.setProperty('--course-d', colorDark);
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
          <button type="button" className="h-11 px-2 text-sm text-tie sm:h-9" onClick={() => setParam('courses', null)}>
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
          <input type="checkbox" className="size-4 accent-(--tie)" checked={showPrep} onChange={(e) => setParam('prep', e.target.checked ? null : '0')} />
          Prep blocks
        </label>
        <label className="flex h-11 items-center gap-2 text-sm sm:h-9">
          <input type="checkbox" className="size-4 accent-(--tie)" checked={showReminders} onChange={(e) => setParam('reminders', e.target.checked ? null : '0')} />
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
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,listWeek' }}
          buttonText={{ today: 'Today', month: 'Month', week: 'Week', list: 'List' }}
          firstDay={1}
          height="auto"
          nowIndicator
          allDayText="All day"
          scrollTime="08:00:00"
          slotMinTime="07:00:00"
          eventTimeFormat={{ hour: 'numeric', minute: '2-digit', meridiem: 'short' }}
          noEventsText="Nothing scheduled. Click a day to add an item."
          events={events}
          eventDidMount={onMount}
          datesSet={(arg) => localStorage.setItem(VIEW_KEY, arg.view.type)}
          eventClick={(arg) => {
            const id = (arg.event.extendedProps as { itemId?: string }).itemId;
            if (id) openItem(id);
          }}
          dateClick={(arg) => {
            const date = arg.allDay ? arg.dateStr.slice(0, 10) : toTorontoDate(arg.date);
            openQuickAdd({ date, time: arg.allDay ? undefined : toTorontoTime(arg.date) });
          }}
          fixedWeekCount={false}
        />
      ) : (
        <div className="h-96" aria-busy />
      )}
      <p className="text-xs text-muted-foreground">
        Times shown in your device&apos;s time zone. Items without a time show as all day with &quot;(time TBD)&quot;.
      </p>
    </div>
  );
}
