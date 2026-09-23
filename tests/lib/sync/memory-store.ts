import { randomUUID } from 'node:crypto';
import type { ItemStore, NewProposal, ProposalRow } from '@/lib/sync/items';
import type { ExistingItem } from '@/lib/sync/merge';

// In-memory ItemStore for sync tests. It copies the items_log_changes trigger:
// every update logs one row per tracked field whose text value changed.

const TRACKED = [
  'title', 'kind', 'starts_at', 'due_at', 'ends_at', 'all_day', 'location', 'seat',
  'weight_percent', 'flags', 'state', 'progress', 'source_missing_at',
];

export type MemItem = ExistingItem & Record<string, unknown> & { source: string; last_change_source: string | null };

export interface MemChange {
  item_id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  source: string;
}

function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return `{${v.join(',')}}`;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toISOString();
  return String(v);
}

export class MemoryStore implements ItemStore {
  items: MemItem[] = [];
  changes: MemChange[] = [];
  proposals: (ProposalRow & NewProposal)[] = [];
  writes = 0;

  add(row: Partial<MemItem> & { source: string; source_ref: string; title: string }): MemItem {
    const item: MemItem = {
      id: randomUUID(),
      due_at: null,
      starts_at: null,
      ends_at: null,
      all_day: true,
      time_known: false,
      location: null,
      source_url: null,
      flags: [],
      locked_fields: [],
      source_missing_at: null,
      state: 'active',
      progress: 'todo',
      kind: 'other',
      last_change_source: null,
      ...row,
    };
    this.items.push(item);
    return item;
  }

  get(source: string, ref: string): MemItem | undefined {
    return this.items.find((i) => i.source === source && i.source_ref === ref);
  }

  async findItems(source: string, refs: string[] | null) {
    return this.items.filter((i) => i.source === source && (!refs || refs.includes(i.source_ref))).map((i) => ({ ...i }));
  }

  async insertItem(row: Record<string, unknown>) {
    const r = row as MemItem;
    if (this.get(r.source, r.source_ref)) throw new Error('duplicate key (user_id, source, source_ref)');
    this.writes++;
    this.add({ ...r });
  }

  async updateItem(id: string, patch: object) {
    const item = this.items.find((i) => i.id === id);
    if (!item) throw new Error('no such item');
    this.writes++;
    const before = { ...item };
    Object.assign(item, patch as Record<string, unknown>);
    for (const f of TRACKED) {
      const a = text(before[f]);
      const b = text(item[f]);
      if (a !== b) this.changes.push({ item_id: id, field: f, old_value: a, new_value: b, source: item.last_change_source ?? 'unknown' });
    }
  }

  async findProposals(source: string) {
    return this.proposals.filter((p) => p.payload.source === source);
  }

  async insertProposal(row: NewProposal) {
    this.writes++;
    this.proposals.push({ ...row, id: randomUUID(), state: 'pending' });
  }

  async supersedeProposal(id: string) {
    this.writes++;
    const p = this.proposals.find((x) => x.id === id);
    if (p) p.state = 'superseded';
  }
}
