import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types';
import { bestCopy, chunkNote } from './chunk';

// Chunk rebuild for one note (Phase 5 task 6). Runs after cleanup and after an
// edit. Takes whichever client the caller has: the service role in jobs, the
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
