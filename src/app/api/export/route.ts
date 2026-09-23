import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient, requireUser } from '@/lib/db/server';
import { buildExportZip, exportFileName } from '@/lib/export/build';
import { loadExport } from '@/lib/export/load';
import { toTorontoDate } from '@/lib/time';

// Settings, Data: GET /api/export downloads everything Dylan owns as one zip.

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  const user = await requireUser().catch(() => null);
  if (!user) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const supabase = await createClient();
  const now = new Date();
  try {
    const zip = buildExportZip(await loadExport(supabase as unknown as SupabaseClient, now));
    return new Response(zip as Uint8Array<ArrayBuffer>, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${exportFileName(toTorontoDate(now))}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    console.error('export failed:', e instanceof Error ? e.message : e);
    return Response.json({ error: 'The export couldn’t be made. Try again in a minute.' }, { status: 500 });
  }
}
