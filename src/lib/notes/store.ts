import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types';
import { bestCopy, chunkNote } from './chunk';

// Chunk rebuild for one note (Phase 5 task 6) or one stored document (Phase 6,
// so Ask can cite outlines and announcements). Notes rebuild after cleanup and
// after an edit; documents once, when stored. Takes whichever client the caller has: the service role in jobs, the
// signed-in user's client in server actions (RLS then scopes it).

type Db = SupabaseClient<Database>;

export interface ChunkSource {
  id: string;
  user_id: string;
  course_id: string | null;
  original_md: string;
  cleaned_md: string | null;
  edited_md: string | null;
}

export async function rebuildNoteChunks(db: Db, note: ChunkSource): Promise<number> {
  const chunks = chunkNote(bestCopy(note));
  const { error: delErr } = await db.from('chunks').delete().eq('parent_type', 'note').eq('parent_id', note.id);
  if (delErr) throw new Error(`Could not clear the note's chunks: ${delErr.message}`);
  if (!chunks.length) return 0;
  const { error } = await db.from('chunks').insert(
    chunks.map((c) => ({
      user_id: note.user_id,
      course_id: note.course_id,
      parent_type: 'note',
      parent_id: note.id,
      ord: c.ord,
      heading: c.heading,
      content: c.content,
      token_estimate: c.token_estimate,
    })),
  );
  if (error) throw new Error(`Could not save the note's chunks: ${error.message}`);
  return chunks.length;
}

export interface DocumentChunkSource {
  id: string;
  user_id: string;
  course_id: string | null;
  kind: string;
  raw_text: string;
  source_ref: string | null;
}

/**
 * Chunks a stored document's raw text. A page keeps chunks for its newest
 * snapshot only, so Ask doesn't cite a version of the page that has changed.
 */
export async function rebuildDocumentChunks(db: Db, doc: DocumentChunkSource): Promise<number> {
  if (doc.kind === 'page_snapshot' && doc.source_ref) {
    const { data: older } = await db
      .from('documents')
      .select('id')
      .eq('user_id', doc.user_id)
      .eq('kind', 'page_snapshot')
      .eq('source_ref', doc.source_ref)
      .neq('id', doc.id);
    const ids = (older ?? []).map((d) => d.id);
    if (ids.length) {
      const { error } = await db.from('chunks').delete().eq('parent_type', 'document').in('parent_id', ids);
      if (error) throw new Error(`Could not clear the older snapshot chunks: ${error.message}`);
    }
  }
  const chunks = chunkNote(doc.raw_text);
  const { error: delErr } = await db.from('chunks').delete().eq('parent_type', 'document').eq('parent_id', doc.id);
  if (delErr) throw new Error(`Could not clear the document's chunks: ${delErr.message}`);
  if (!chunks.length) return 0;
  const rows = chunks.map((c) => ({
    user_id: doc.user_id,
    course_id: doc.course_id,
    parent_type: 'document',
    parent_id: doc.id,
    ord: c.ord,
    heading: c.heading,
    content: c.content,
    token_estimate: c.token_estimate,
  }));
  // A whole book makes thousands of chunks: insert them a few hundred at a time.
  let error: { message: string } | null = null;
  for (let i = 0; i < rows.length && !error; i += 400) ({ error } = await db.from('chunks').insert(rows.slice(i, i + 400)));
  if (error) throw new Error(`Could not save the document's chunks: ${error.message}`);
  return chunks.length;
}
