import { addDaysToDate, fromTorontoLocal, toTorontoDate } from '@/lib/time';

// Merge rules for every sync (docs/SOURCES.md, "Merge rules for all syncs"):
// - Precision never drops: a date-only value doesn't overwrite a known time on the same local date.
// - Syncs don't own state or progress: they touch title, dates, location, URL, and their own flags.
// - Dylan's edits win: a disagreement with a locked field becomes a proposal instead of a write.
// - A null from a source never clears a value (a page going quiet is not a correction).

export type ItemSource = 'learn_ics' | 'cs251_schedule' | 'open_data';
export type ChangeSource = ItemSource | 'cs251_examinfo' | 'cs251_assignments';

/** What a source knows about an item's timing. */
export type IncomingWhen =
  | { type: 'date'; date: string; endDate: string | null }
  | { type: 'timed'; dueAt: string; startsAt: string | null; endsAt: string | null }
  | null;

export interface IncomingItem {
  sourceRef: string;
  kind: string;
  title: string;
  when: IncomingWhen;
  location: string | null;
  sourceUrl: string | null;
  flags: string[];
  courseId: string | null;
  description?: string | null;
}

export interface ExistingItem {
  id: string;
  source_ref: string;
  title: string;
  due_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  all_day: boolean;
  time_known: boolean;
  location: string | null;
  source_url: string | null;
  flags: string[];
  locked_fields: string[];
  source_missing_at: string | null;
  state: string;
}

/** Columns a sync may write. */
export interface ItemPatch {
  title?: string;
  due_at?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  all_day?: boolean;
  time_known?: boolean;
  location?: string | null;
  source_url?: string | null;
  flags?: string[];
  source_missing_at?: string | null;
}

export interface MergeOptions {
  /** Flags this source controls. On update, only these are added or removed. */
  ownedFlags: string[];
}

export interface MergePlan {
  /** Fields to write now. Empty when nothing changed. */
  patch: ItemPatch;
  /** Fields that disagree with Dylan's edits; they go to the review queue. */
  proposed: ItemPatch;
}

const DATE_FIELDS = ['due_at', 'starts_at', 'ends_at', 'all_day', 'time_known'] as const;

function sameInstant(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return new Date(a).getTime() === new Date(b).getTime();
}

function iso(value: string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

/** Column values for a timing, as a fresh row would store them. */
export function whenColumns(when: IncomingWhen): Required<Pick<ItemPatch, (typeof DATE_FIELDS)[number]>> {
  if (!when) return { due_at: null, starts_at: null, ends_at: null, all_day: true, time_known: false };
  if (when.type === 'timed') {
    return { due_at: iso(when.dueAt), starts_at: iso(when.startsAt), ends_at: iso(when.endsAt), all_day: false, time_known: true };
  }
  const dueAt = fromTorontoLocal(when.date, null).toISOString();
  return {
    due_at: dueAt,
    starts_at: when.endDate ? dueAt : null,
    ends_at: when.endDate ? fromTorontoLocal(addDaysToDate(when.endDate, 1), null).toISOString() : null,
    all_day: true,
    time_known: false,
  };
}

/** Timing changes for an existing item, honouring "precision never drops". */
function dateChanges(existing: ExistingItem, when: IncomingWhen): ItemPatch {
  if (!when) return {};
  if (
    when.type === 'date' &&
    !when.endDate &&
    existing.time_known &&
    existing.due_at &&
    toTorontoDate(new Date(existing.due_at)) === when.date
  ) {
    return {};
  }
  const next = whenColumns(when);
  // A timed source that doesn't know the span leaves an existing span alone.
  if (when.type === 'timed' && when.startsAt === null) {
    next.starts_at = existing.starts_at;
    next.ends_at = existing.ends_at;
  }
  const out: ItemPatch = {};
  for (const f of DATE_FIELDS) {
    const a = existing[f];
    const b = next[f];
    const same = typeof a === 'boolean' ? a === b : sameInstant(a as string | null, b as string | null);
    if (!same) (out as Record<string, unknown>)[f] = b;
  }
  if (Object.keys(out).length === 0) return {};
  // Write the whole timing group together so the row never mixes two sources' dates.
  return { ...next };
}

/** Existing flags with the source's owned flags replaced by what it reports now. Order is kept stable. */
export function mergeFlags(existing: string[], incoming: string[], owned: string[]): string[] {
  const kept = existing.filter((f) => !owned.includes(f) || incoming.includes(f));
  for (const f of incoming) if (owned.includes(f) && !kept.includes(f)) kept.push(f);
  return kept;
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

function isLocked(existing: ExistingItem, field: keyof ItemPatch): boolean {
  if ((DATE_FIELDS as readonly string[]).includes(field)) {
    return DATE_FIELDS.some((f) => existing.locked_fields.includes(f));
  }
  return existing.locked_fields.includes(field);
}

/** What a sync should do to one existing item. */
export function planUpdate(existing: ExistingItem, incoming: IncomingItem, opts: MergeOptions): MergePlan {
  const changes: ItemPatch = { ...dateChanges(existing, incoming.when) };
  if (incoming.title && incoming.title !== existing.title) changes.title = incoming.title;
  if (incoming.location && incoming.location !== existing.location) changes.location = incoming.location;
  if (incoming.sourceUrl && incoming.sourceUrl !== existing.source_url) changes.source_url = incoming.sourceUrl;
  const flags = mergeFlags(existing.flags, incoming.flags, opts.ownedFlags);
  if (!sameSet(flags, existing.flags)) changes.flags = flags;
  if (existing.source_missing_at) changes.source_missing_at = null;

  const patch: ItemPatch = {};
  const proposed: ItemPatch = {};
  for (const [field, value] of Object.entries(changes) as [keyof ItemPatch, unknown][]) {
    const target = isLocked(existing, field) ? proposed : patch;
    (target as Record<string, unknown>)[field] = value;
  }
  return { patch, proposed };
}

/** A new row's sync-owned columns. */
export function newItemColumns(incoming: IncomingItem) {
  return {
    course_id: incoming.courseId,
    kind: incoming.kind,
    title: incoming.title,
    description: incoming.description ?? null,
    ...whenColumns(incoming.when),
    location: incoming.location,
    source_url: incoming.sourceUrl,
    flags: incoming.flags,
  };
}
