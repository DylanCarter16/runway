import { fromTorontoLocal } from '@/lib/time';
import type { ParsedEvent, ParsedExam } from '@/lib/sources/types';
import type { IncomingItem, IncomingWhen } from './merge';
import type { ItemStore, SyncStats } from './items';
import { syncItems } from './items';

// The three CS 251 page syncs. The schedule owns the rows; the exam info and
// assignments pages add times and rooms to the same rows (docs/SOURCES.md 2, 3, 3b).

export const CS251_OWNED_FLAGS = {
  cs251_schedule: ['date_tba', 'link_points_to_other_term'],
  cs251_examinfo: ['location_tba'],
  cs251_assignments: ['date_changed'],
} as const;

function eventWhen(e: ParsedEvent): IncomingWhen {
  if (!e.date) return null;
  if (e.timeKnown && e.time) {
    return { type: 'timed', dueAt: fromTorontoLocal(e.date, e.time).toISOString(), startsAt: null, endsAt: null };
  }
  return { type: 'date', date: e.date, endDate: e.endDate };
}

export function eventToIncoming(e: ParsedEvent, courseId: string | null): IncomingItem {
  return {
    sourceRef: e.sourceRef,
    kind: e.kind,
    title: e.title,
    when: eventWhen(e),
    location: null,
    sourceUrl: e.sourceUrl,
    flags: e.flags,
    courseId,
  };
}

export function examToIncoming(e: ParsedExam, courseId: string | null, pageUrl: string): IncomingItem {
  return {
    sourceRef: e.sourceRef,
    kind: e.kind,
    title: e.title,
    when: e.startsAt ? { type: 'timed', dueAt: e.startsAt, startsAt: e.startsAt, endsAt: e.endsAt } : null,
    location: e.location,
    sourceUrl: pageUrl,
    flags: e.flags,
    courseId,
  };
}

/** Rows without a link of their own (the midterm, reading week) link to the schedule page. */
export function syncCs251Schedule(
  store: ItemStore,
  events: ParsedEvent[],
  courseId: string | null,
  pageUrl: string,
  now: Date,
): Promise<SyncStats> {
  const incoming = events.map((e) => ({ ...eventToIncoming(e, courseId), sourceUrl: e.sourceUrl ?? pageUrl }));
  return syncItems(store, incoming, {
    rowSource: 'cs251_schedule',
    changeSource: 'cs251_schedule',
    ownedFlags: [...CS251_OWNED_FLAGS.cs251_schedule],
    trackMissing: { now },
  });
}

export function syncCs251ExamInfo(store: ItemStore, exams: ParsedExam[], courseId: string | null, pageUrl: string): Promise<SyncStats> {
  // No source URL: the schedule sync sets it, and two syncs writing different URLs would flip it every run.
  return syncItems(store, exams.map((e) => ({ ...examToIncoming(e, courseId, pageUrl), sourceUrl: null })), {
    rowSource: 'cs251_schedule',
    changeSource: 'cs251_examinfo',
    ownedFlags: [...CS251_OWNED_FLAGS.cs251_examinfo],
  });
}

export function syncCs251Assignments(store: ItemStore, events: ParsedEvent[], courseId: string | null): Promise<SyncStats> {
  return syncItems(store, events.map((e) => eventToIncoming(e, courseId)), {
    rowSource: 'cs251_schedule',
    changeSource: 'cs251_assignments',
    ownedFlags: [...CS251_OWNED_FLAGS.cs251_assignments],
  });
}
