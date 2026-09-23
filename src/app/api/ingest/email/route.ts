import { after } from 'next/server';
import { createAdminClient } from '@/lib/db/admin';
import { ownerUserId, recordBridgeContact } from '@/lib/digest/load';
import { readSignedRequest } from '@/lib/ingest/request';
import { ingestEmails } from '@/lib/jobs/email';
import { runQueuedJobs } from '@/lib/jobs/schedule';
import { emailBatchSchema } from '@/lib/sources/email';

// Piazza emails from the Apps Script bridge (SOURCES.md 6). Verifies the
// signature, validates the batch, stores new messages (Gmail ids already stored
// are skipped), queues extraction, and answers before the work runs.

export async function POST(request: Request) {
  const signed = await readSignedRequest(request);
  if ('response' in signed) return signed.response;
  let body: unknown;
  try {
    body = JSON.parse(signed.body);
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }
  const parsed = emailBatchSchema.safeParse(body);
  if (!parsed.success) return new Response('Bad batch', { status: 400 });
  const admin = createAdminClient();
  const userId = await ownerUserId(admin);
  if (!userId) return new Response('No account for ALLOWED_EMAIL yet', { status: 409 });

  const result = await ingestEmails(admin, userId, parsed.data);
  await recordBridgeContact(admin, userId, { kind: 'email', messages: result.received, stored: result.stored, skipped: result.skipped });
  if (result.toProcess.length) {
    after(async () => {
      try {
        await runQueuedJobs(admin);
      } catch (e) {
        console.error('job worker failed:', e instanceof Error ? e.message : e);
      }
    });
  }
  return Response.json({ accepted: result.received, stored: result.stored, skipped: result.skipped }, { status: 202 });
}
