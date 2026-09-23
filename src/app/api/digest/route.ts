import { createAdminClient } from '@/lib/db/admin';
import { loadDigest, ownerUserId, recordBridgeContact } from '@/lib/digest/load';
import { readSignedRequest } from '@/lib/ingest/request';

// The morning digest for the Apps Script bridge (docs/SPEC.md section 6). Signed GET
// with an empty body; answers { send, subject, text, html }.

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const signed = await readSignedRequest(request);
  if ('response' in signed) return signed.response;
  const admin = createAdminClient();
  const userId = await ownerUserId(admin);
  if (!userId) return Response.json({ send: false, subject: '', text: '', html: '' });
  const digest = await loadDigest(admin, userId);
  await recordBridgeContact(admin, userId, { kind: 'digest', send: digest.send });
  return Response.json(digest);
}
