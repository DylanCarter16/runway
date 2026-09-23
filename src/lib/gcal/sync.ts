import { createHash } from 'node:crypto';
import type { PlannedEvent } from '@/lib/reminders/events';
import { TIME_ZONE } from '@/lib/time';

// Calendar sync as a reconcile: list what the Runway calendar holds, compare each
// event's stored hash with the hash of what it should be, and write only the
// differences. Running it twice makes no writes the second time. Events without a
// runwayId (ones Dylan added by hand) are never touched.

export const RUNWAY_CALENDAR_NAME = 'Runway';

export interface GoogleEventBody {
  summary: string;
  description: string;
  location?: string;
  start: { date: string } | { dateTime: string; timeZone: string };
  end: { date: string } | { dateTime: string; timeZone: string };
  transparency: 'opaque' | 'transparent';
  reminders: {
    useDefault: false;
    overrides: { method: 'popup'; minutes: number }[];
  };
  extendedProperties: { private: { runwayId: string; runwayHash: string } };
}

export interface RemoteEvent {
  id: string;
  runwayId: string | null;
  runwayHash: string | null;
}

/** The Google Calendar calls the sync needs. The live one wraps googleapis; tests use a fake. */
export interface CalendarApi {
  listEvents(calendarId: string): Promise<RemoteEvent[]>;
  insertEvent(calendarId: string, body: GoogleEventBody): Promise<string>;
  updateEvent(calendarId: string, eventId: string, body: GoogleEventBody): Promise<void>;
  deleteEvent(calendarId: string, eventId: string): Promise<void>;
  createCalendar(name: string, timeZone: string): Promise<string>;
}

export interface DesiredEvent {
  planned: PlannedEvent;
  hash: string;
  body: GoogleEventBody;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function time(t: PlannedEvent['start']): GoogleEventBody['start'] {
  return 'date' in t ? { date: t.date } : { dateTime: t.dateTime, timeZone: TIME_ZONE };
}

/** The Google body for a planned event, with a hash of everything that shows. */
export function toDesired(planned: PlannedEvent): DesiredEvent {
  const shown = {
    summary: planned.summary,
    description: planned.description,
    ...(planned.location ? { location: planned.location } : {}),
    start: time(planned.start),
    end: time(planned.end),
    transparency: planned.transparent ? ('transparent' as const) : ('opaque' as const),
    reminders: {
      useDefault: false as const,
      overrides: planned.reminders.map((minutes) => ({
        method: 'popup' as const,
        minutes,
      })),
    },
  };
  const hash = createHash('sha256').update(stable(shown)).digest('hex').slice(0, 32);
  return {
    planned,
    hash,
    body: {
      ...shown,
      extendedProperties: {
        private: { runwayId: planned.runwayId, runwayHash: hash },
      },
    },
  };
}

export interface CalendarDiff {
  insert: DesiredEvent[];
  update: { eventId: string; event: DesiredEvent }[];
  remove: string[];
  /** runwayId to Google event id for events that already match. */
  unchanged: Map<string, string>;
}

export function diffCalendar(desired: DesiredEvent[], remote: RemoteEvent[]): CalendarDiff {
  const byRunwayId = new Map<string, RemoteEvent>();
  const diff: CalendarDiff = {
    insert: [],
    update: [],
    remove: [],
    unchanged: new Map(),
  };
  for (const r of remote) {
    if (!r.runwayId) continue;
    // A duplicate (say, from an insert whose response was lost) goes.
    if (byRunwayId.has(r.runwayId)) diff.remove.push(r.id);
    else byRunwayId.set(r.runwayId, r);
  }
  const wanted = new Set<string>();
  for (const d of desired) {
    const id = d.planned.runwayId;
    if (wanted.has(id)) continue;
    wanted.add(id);
    const r = byRunwayId.get(id);
    if (!r) diff.insert.push(d);
    else if (r.runwayHash !== d.hash) diff.update.push({ eventId: r.id, event: d });
    else diff.unchanged.set(id, r.id);
  }
  for (const [id, r] of byRunwayId) if (!wanted.has(id)) diff.remove.push(r.id);
  return diff;
}

export interface ApplyResult {
  inserted: number;
  updated: number;
  removed: number;
  /** runwayId to Google event id, for every desired event that is on the calendar now. */
  ids: Map<string, string>;
  /** False when the time budget ran out; the caller queues another run. */
  complete: boolean;
}

/** Writes the diff: updates and inserts first (they matter most), then removals. */
export async function applyDiff(
  api: CalendarApi,
  calendarId: string,
  diff: CalendarDiff,
  opts: { deadline: number; now?: () => number } = {
    deadline: Number.POSITIVE_INFINITY,
  },
): Promise<ApplyResult> {
  const clock = opts.now ?? Date.now;
  const result: ApplyResult = {
    inserted: 0,
    updated: 0,
    removed: 0,
    ids: new Map(diff.unchanged),
    complete: false,
  };
  const outOfTime = () => clock() >= opts.deadline;

  for (const u of diff.update) {
    if (outOfTime()) return result;
    await api.updateEvent(calendarId, u.eventId, u.event.body);
    result.ids.set(u.event.planned.runwayId, u.eventId);
    result.updated++;
  }
  for (const d of diff.insert) {
    if (outOfTime()) return result;
    result.ids.set(d.planned.runwayId, await api.insertEvent(calendarId, d.body));
    result.inserted++;
  }
  for (const id of diff.remove) {
    if (outOfTime()) return result;
    await api.deleteEvent(calendarId, id);
    result.removed++;
  }
  result.complete = true;
  return result;
}

export function totalWrites(r: Pick<ApplyResult, 'inserted' | 'updated' | 'removed'>): number {
  return r.inserted + r.updated + r.removed;
}
