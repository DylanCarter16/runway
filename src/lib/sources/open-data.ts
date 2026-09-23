import { z } from 'zod';
import type { IncomingItem } from '@/lib/sync/merge';
import { fromTorontoLocal } from '@/lib/time';
import { clock } from './html';
import { politeFetch } from './fetch';

// UW Open Data API v3 (docs/SOURCES.md section 7). Mappers are pure; fetchOpenData
// does the HTTP. Responses are validated loosely because the API's formats are
// documented only by its swagger file.

export const OPEN_DATA_BASE = 'https://openapi.data.uwaterloo.ca';

const str = z.string().nullish();

export const termSchema = z.object({ termBeginDate: z.string(), termEndDate: z.string() }).loose();

export const examRowSchema = z
  .object({
    examDisplayName: z.string(),
    sections: str,
    day: str,
    examWindowStartDate: str,
    examWindowStartTime: str,
    examDuration: z.union([z.string(), z.number()]).nullish(),
    location: str,
    isOnlineDescription: str,
    notes: str,
  })
  .loose();

export const importantDateSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    name: z.string(),
    details: z
      .array(z.object({ termName: str, startDate: str, endDate: str }).loose())
      .nullish()
      .transform((d) => d ?? []),
  })
  .loose();

export type ExamRow = z.infer<typeof examRowSchema>;
export type ImportantDate = z.infer<typeof importantDateSchema>;

export interface OpenDataCourse {
  id: string;
  code: string;
  slug: string;
  /** Dylan's section numbers from the Quest meetings ("001"). */
  sections: string[];
}

/** "2026-12-14T00:00:00" → "2026-12-14". */
function datePart(s: string | null | undefined): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s ?? '');
  return m ? m[1] : null;
}

/** "9:00 AM", "09:00:00", "7:30 PM" → "HH:MM". */
export function parseApiTime(s: string | null | undefined): string | null {
  const m = /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?\s*$/i.exec(s ?? '');
  return m ? clock(m[1], m[2], m[3]) : null;
}

/** "02:30:00", "2:30", 150, "150" → minutes. */
export function parseDuration(d: string | number | null | undefined): number | null {
  if (typeof d === 'number') return d > 0 ? d : null;
  if (!d) return null;
  const hms = /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*$/.exec(d);
  if (hms) return Number(hms[1]) * 60 + Number(hms[2]);
  const n = Number(d);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function codeKey(code: string): string {
  return code.toUpperCase().replace(/\s+/g, '');
}

function sectionList(s: string | null | undefined): string[] {
  return (s ?? '').split(/[^0-9]+/).filter(Boolean).map((x) => x.padStart(3, '0'));
}

/** Official term dates for correcting terms.starts_on and ends_on. */
export function mapTerm(json: unknown): { startsOn: string; endsOn: string } | null {
  const t = termSchema.safeParse(json);
  if (!t.success) return null;
  const startsOn = datePart(t.data.termBeginDate);
  const endsOn = datePart(t.data.termEndDate);
  return startsOn && endsOn ? { startsOn, endsOn } : null;
}

/**
 * Final exam rows for Dylan's courses. A course with several rows keeps the one
 * listing his section; with one row, that row.
 */
export function mapExamRows(rows: ExamRow[], courses: OpenDataCourse[]): IncomingItem[] {
  const out: IncomingItem[] = [];
  for (const course of courses) {
    // "CS 251" matches "CS 251" and "CS251 (001)" but not "CS 2510".
    const code = new RegExp(`^${codeKey(course.code)}(?![0-9])`);
    const mine = rows.filter((r) => code.test(codeKey(r.examDisplayName)));
    if (!mine.length) continue;
    const row = mine.length === 1 ? mine[0] : mine.find((r) => sectionList(r.sections).some((s) => course.sections.includes(s)));
    if (!row) continue;

    const date = datePart(row.examWindowStartDate);
    const time = parseApiTime(row.examWindowStartTime);
    const duration = parseDuration(row.examDuration);
    let when: IncomingItem['when'] = null;
    if (date && time) {
      const start = fromTorontoLocal(date, time);
      const end = duration ? new Date(start.getTime() + duration * 60_000).toISOString() : null;
      when = { type: 'timed', dueAt: start.toISOString(), startsAt: start.toISOString(), endsAt: end };
    } else if (date) {
      when = { type: 'date', date, endDate: null };
    }
    const online = row.isOnlineDescription && !/^(no|false|in[- ]person)$/i.test(row.isOnlineDescription) ? row.isOnlineDescription : null;
    out.push({
      sourceRef: `final:${course.slug}`,
      kind: 'final',
      title: 'Final exam',
      when,
      location: row.location?.trim() || online,
      sourceUrl: 'https://uwaterloo.ca/the-centre/academics/final-examination-schedule',
      flags: [],
      courseId: course.id,
      description: [row.notes?.trim(), row.sections ? `Sections ${row.sections}` : null].filter(Boolean).join('. ') || null,
    });
  }
  return out;
}

/** Important dates for one term ("Fall 2026") as term-wide admin and break items. */
export function mapImportantDates(entries: ImportantDate[], termName: string): IncomingItem[] {
  const out: IncomingItem[] = [];
  for (const entry of entries) {
    for (const d of entry.details) {
      if ((d.termName ?? '').trim().toLowerCase() !== termName.toLowerCase()) continue;
      const start = datePart(d.startDate);
      if (!start) continue;
      const end = datePart(d.endDate);
      out.push({
        sourceRef: `date:${entry.id}`,
        kind: /reading week|break|holiday|thanksgiving|no classes/i.test(entry.name) ? 'break' : 'admin',
        title: entry.name.trim(),
        when: { type: 'date', date: start, endDate: end && end !== start ? end : null },
        location: null,
        sourceUrl: 'https://uwaterloo.ca/registrar/important-dates',
        flags: [],
        courseId: null,
      });
      break;
    }
  }
  return out;
}

export class OpenDataError extends Error {}

/** GET a v3 path. 204 and 404 mean "nothing published", returned as null. */
export async function fetchOpenData(path: string, apiKey: string, userAgent: string): Promise<unknown | null> {
  const res = await politeFetch(`${OPEN_DATA_BASE}${path}`, { userAgent, headers: { 'x-api-key': apiKey, accept: 'application/json' } });
  if (res.status === 204 || res.status === 404) return null;
  if (res.status === 401 || res.status === 403) throw new OpenDataError('UW Open Data rejected the API key. Check UW_OPENDATA_API_KEY.');
  if (!res.ok) throw new OpenDataError(`UW Open Data answered HTTP ${res.status} for ${path}.`);
  const text = res.body.trim();
  return text ? JSON.parse(text) : null;
}
