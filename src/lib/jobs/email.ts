import 'server-only';
import type { Json } from '@/lib/db/types';
import { ingestEmailBatch, type EmailBatch, type EmailStore, type IngestResult } from '@/lib/sources/email';
import { extractJob } from './inbox';
import { enqueue, type Admin } from './queue';

// Piazza emails from the bridge (POST /api/ingest/email): store the new ones as
// documents and queue extraction for those with a course. The extract job runs
// the AI switch, so AI-off courses are stored and listed, never sent to Claude.

export function supabaseEmailStore(admin: Admin, userId: string): EmailStore {
  return {
    async knownIds(ids) {
      if (!ids.length) return new Set();
      const { data, error } = await admin
        .from('documents')
        .select('source_ref')
        .eq('user_id', userId)
        .eq('kind', 'piazza_email')
        .in('source_ref', ids);
      if (error) throw new Error(`Could not read stored emails: ${error.message}`);
      return new Set((data ?? []).map((d) => d.source_ref as string));
    },
    async insert(row) {
      const { data, error } = await admin
        .from('documents')
        .insert({ ...row, meta: row.meta as unknown as Json })
        .select('id')
        .single();
      if (error?.code === '23505') return null;
      if (error) throw new Error(`Could not store an email: ${error.message}`);
      return data;
    },
  };
}

export async function loadPiazzaMapping(admin: Admin, userId: string) {
  const [{ data: settings }, { data: courses, error }] = await Promise.all([
    admin.from('settings').select('piazza_map').eq('user_id', userId).maybeSingle(),
    admin.from('courses').select('id, slug').eq('user_id', userId).eq('archived', false),
  ]);
  if (error) throw new Error(`Could not read courses: ${error.message}`);
  const map = settings?.piazza_map;
  return {
    piazzaMap: map && typeof map === 'object' && !Array.isArray(map) ? (map as Record<string, unknown>) : {},
    courses: courses ?? [],
  };
}

export async function ingestEmails(admin: Admin, userId: string, batch: EmailBatch): Promise<IngestResult> {
  const { piazzaMap, courses } = await loadPiazzaMapping(admin, userId);
  const result = await ingestEmailBatch(supabaseEmailStore(admin, userId), userId, batch, piazzaMap, courses);
  for (const id of result.toProcess) await enqueue(admin, extractJob(userId, id));
  return result;
}

/**
 * After Dylan maps a Piazza class, its waiting emails (no course yet) move to
 * that course and get read like new ones. Returns how many moved.
 */
export async function fileWaitingEmails(admin: Admin, userId: string): Promise<number> {
  const { piazzaMap, courses } = await loadPiazzaMapping(admin, userId);
  const { data, error } = await admin
    .from('documents')
    .select('id, meta')
    .eq('user_id', userId)
    .eq('kind', 'piazza_email')
    .is('course_id', null)
    .limit(500);
  if (error) throw new Error(`Could not read waiting emails: ${error.message}`);
  let moved = 0;
  for (const doc of data ?? []) {
    const meta = (doc.meta ?? {}) as Record<string, unknown>;
    const slug = typeof meta.class_id === 'string' ? piazzaMap[meta.class_id] : undefined;
    const course = courses.find((c) => c.slug === slug);
    if (!course) continue;
    const rest = { ...meta };
    delete rest.status;
    delete rest.notes;
    const { error: upErr } = await admin
      .from('documents')
      .update({ course_id: course.id, processed_at: null, meta: rest as Json })
      .eq('id', doc.id);
    if (upErr) throw new Error(`Could not file an email: ${upErr.message}`);
    await enqueue(admin, extractJob(userId, doc.id));
    moved++;
  }
  return moved;
}
