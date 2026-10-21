import { z } from 'zod';
import { createClient, requireUser } from '@/lib/db/server';
import { LIBRARY_BUCKET } from '@/lib/files/constants';
import { StorageReadLimitError, recordStorageRead } from '@/lib/files/storage-reads';

// "Open the original" on a Library page. The link is signed when it is clicked, not each time
// the page renders (a page refresh used to mint a new signed URL), and every open is counted.

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: RouteContext<'/api/files/[id]/original'>) {
  const user = await requireUser().catch(() => null);
  if (!user) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: 'Unknown file.' }, { status: 404 });
  const supabase = await createClient();
  const { data: doc } = await supabase.from('documents').select('id, storage_path').eq('id', id).maybeSingle();
  if (!doc?.storage_path) return Response.json({ error: 'Unknown file.' }, { status: 404 });
  try {
    await recordStorageRead(supabase, doc.id, 'original');
  } catch (e) {
    if (e instanceof StorageReadLimitError) return Response.json({ error: e.message }, { status: 429 });
    throw e;
  }
  const { data, error } = await supabase.storage.from(LIBRARY_BUCKET).createSignedUrl(doc.storage_path, 60);
  if (error || !data) return Response.json({ error: 'The file could not be opened. Try again in a minute.' }, { status: 502 });
  return new Response(null, { status: 302, headers: { Location: data.signedUrl, 'Cache-Control': 'private, no-store' } });
}
