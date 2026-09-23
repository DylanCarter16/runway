import 'server-only';
import type { Json } from '@/lib/db/types';
import type { ItemStore, ProposalRow } from '@/lib/sync/items';
import type { ExistingItem } from '@/lib/sync/merge';
import type { Admin } from './queue';

// ItemStore over Supabase with the service-role client. The service role skips
// RLS, so every query filters on user_id itself.

const ITEM_FIELDS =
  'id, source_ref, title, due_at, starts_at, ends_at, all_day, time_known, location, source_url, flags, locked_fields, source_missing_at, state';

export function supabaseItemStore(admin: Admin, userId: string): ItemStore {
  return {
    async findItems(source, refs) {
      if (refs && refs.length === 0) return [];
      let q = admin.from('items').select(ITEM_FIELDS).eq('user_id', userId).eq('source', source);
      if (refs) q = q.in('source_ref', refs);
      const { data, error } = await q;
      if (error) throw new Error(`Could not read items: ${error.message}`);
      return (data ?? []) as ExistingItem[];
    },

    async insertItem(row) {
      const { error } = await admin.from('items').insert({ ...row, user_id: userId });
      if (error) throw new Error(`Could not add ${row.title}: ${error.message}`);
    },

    async updateItem(id, patch) {
      const { error } = await admin.from('items').update(patch).eq('id', id).eq('user_id', userId);
      if (error) throw new Error(`Could not update an item: ${error.message}`);
    },

    async findProposals(source) {
      const { data, error } = await admin
        .from('proposals')
        .select('id, kind, target_item_id, state, payload')
        .eq('user_id', userId)
        .eq('payload->>source', source);
      if (error) throw new Error(`Could not read proposals: ${error.message}`);
      return (data ?? []) as ProposalRow[];
    },

    async insertProposal(row) {
      const { error } = await admin.from('proposals').insert({ ...row, payload: row.payload as Json, user_id: userId });
      if (error) throw new Error(`Could not save a proposal: ${error.message}`);
    },

    async supersedeProposal(id) {
      const { error } = await admin
        .from('proposals')
        .update({ state: 'superseded', decided_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', userId);
      if (error) throw new Error(`Could not update a proposal: ${error.message}`);
    },
  };
}
