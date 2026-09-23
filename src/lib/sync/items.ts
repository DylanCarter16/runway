import { sourceLabel } from '@/lib/items/labels';
import {
  newItemColumns,
  planUpdate,
  type ChangeSource,
  type ExistingItem,
  type IncomingItem,
  type ItemPatch,
  type ItemSource,
} from './merge';

// Writes one source's parsed items with the merge rules. Storage sits behind
// ItemStore so the same code runs against Supabase and against the in-memory
// store the tests use.

export interface ProposalRow {
  id: string;
  kind: string;
  target_item_id: string | null;
  state: string;
  payload: Record<string, unknown>;
}

export interface NewProposal {
  course_id: string | null;
  kind: 'create_item' | 'update_item';
  target_item_id: string | null;
  payload: Record<string, unknown>;
  evidence: string;
}

export interface ItemStore {
  /** Items with this source; all of them when refs is null. */
  findItems(source: ItemSource, refs: string[] | null): Promise<ExistingItem[]>;
  insertItem(row: ReturnType<typeof newItemColumns> & { source: ItemSource; source_ref: string; last_change_source: ChangeSource }): Promise<void>;
  updateItem(id: string, patch: ItemPatch & { last_change_source: ChangeSource }): Promise<void>;
  /** Proposals whose payload.source matches, in any state. */
  findProposals(source: ChangeSource): Promise<ProposalRow[]>;
  insertProposal(row: NewProposal): Promise<void>;
  supersedeProposal(id: string): Promise<void>;
}

export interface SyncStats {
  seen: number;
  created: number;
  updated: number;
  unchanged: number;
  proposals: number;
  missing: number;
}

export interface SyncItemsOptions {
  /** items.source for the rows (the exam info and assignments syncs write under cs251_schedule). */
  rowSource: ItemSource;
  /** items.last_change_source and the change log's source. */
  changeSource: ChangeSource;
  ownedFlags: string[];
  /**
   * Set source_missing_at on this source's upcoming items that the source no longer lists.
   * Only for sources that list everything they know (LEARN, the CS 251 schedule).
   */
  trackMissing?: { now: Date };
}

/** Stable JSON with sorted keys: jsonb stores object keys in its own order. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
    return `{${entries
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

export function emptyStats(): SyncStats {
  return { seen: 0, created: 0, updated: 0, unchanged: 0, proposals: 0, missing: 0 };
}

export async function syncItems(store: ItemStore, incoming: IncomingItem[], opts: SyncItemsOptions): Promise<SyncStats> {
  const stats = emptyStats();
  stats.seen = incoming.length;
  const refs = incoming.map((i) => i.sourceRef);
  const existing = await store.findItems(opts.rowSource, opts.trackMissing ? null : refs);
  const byRef = new Map(existing.map((e) => [e.source_ref, e]));
  let proposals: ProposalRow[] | null = null;
  const loadProposals = async () => (proposals ??= await store.findProposals(opts.changeSource));

  for (const item of incoming) {
    const row = byRef.get(item.sourceRef);
    if (!row) {
      await store.insertItem({
        ...newItemColumns(item),
        source: opts.rowSource,
        source_ref: item.sourceRef,
        last_change_source: opts.changeSource,
      });
      stats.created++;
      continue;
    }

    const plan = planUpdate(row, item, { ownedFlags: opts.ownedFlags });
    if (Object.keys(plan.patch).length) {
      await store.updateItem(row.id, { ...plan.patch, last_change_source: opts.changeSource });
      stats.updated++;
    } else {
      stats.unchanged++;
    }

    const pending = (await loadProposals()).filter(
      (p) => p.kind === 'update_item' && p.target_item_id === row.id && p.state === 'pending',
    );
    if (Object.keys(plan.proposed).length) {
      const payload = { source: opts.changeSource, source_ref: item.sourceRef, title: row.title, changes: plan.proposed };
      if (pending.some((p) => jsonEqual(p.payload, payload))) continue;
      for (const p of pending) await store.supersedeProposal(p.id);
      await store.insertProposal({
        course_id: item.courseId,
        kind: 'update_item',
        target_item_id: row.id,
        payload,
        evidence: `${sourceLabel(opts.changeSource)} disagrees with your edit to ${row.title}.`,
      });
      stats.proposals++;
    } else {
      // The source agrees with Dylan again; an older proposal is out of date.
      for (const p of pending) await store.supersedeProposal(p.id);
    }
  }

  if (opts.trackMissing) {
    const listed = new Set(refs);
    const now = opts.trackMissing.now;
    for (const row of existing) {
      if (listed.has(row.source_ref) || row.source_missing_at || row.state !== 'active') continue;
      const when = row.due_at ?? row.starts_at;
      if (!when || new Date(when) < now) continue;
      await store.updateItem(row.id, { source_missing_at: now.toISOString(), last_change_source: opts.changeSource });
      stats.missing++;
    }
  }
  return stats;
}

/**
 * Items a source found but couldn't place in a course become create proposals
 * with course unset. Each source_ref is proposed once, whatever Dylan decided.
 */
export async function proposeUnmatched(
  store: ItemStore,
  incoming: IncomingItem[],
  source: ChangeSource,
): Promise<number> {
  if (!incoming.length) return 0;
  const known = new Set((await store.findProposals(source)).map((p) => p.payload.source_ref));
  let n = 0;
  for (const item of incoming) {
    if (known.has(item.sourceRef)) continue;
    await store.insertProposal({
      course_id: null,
      kind: 'create_item',
      target_item_id: null,
      payload: { source, source_ref: item.sourceRef, item: newItemColumns(item) },
      evidence: `${sourceLabel(source)} lists "${item.title}" but it matches no course.`,
    });
    n++;
  }
  return n;
}
