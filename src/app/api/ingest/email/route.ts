import { z } from 'zod';
import { createAdminClient } from '@/lib/db/admin';
import { ownerUserId, recordBridgeContact } from '@/lib/digest/load';
import { readSignedRequest } from '@/lib/ingest/request';

// Stub until Phase 7: verifies the signature and the batch shape, stores nothing, and
// answers 202 so the bridge's 15-minute runs don't log errors.

const batchSchema = z.object({
  source: z.string().max(40),
  messages: z.array(z.object({ id: z.string().max(200) }).loose()).max(50),
});

export async function POST(request: Request) {
  const signed = await readSignedRequest(request);
  if ('response' in signed) return signed.response;
  let body: unknown;
  try {
    body = JSON.parse(signed.body);
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }
  const parsed = batchSchema.safeParse(body);
  if (!parsed.success) return new Response('Bad batch', { status: 400 });
  const admin = createAdminClient();
  const userId = await ownerUserId(admin);
  if (userId) await recordBridgeContact(admin, userId, { kind: 'email', messages: parsed.data.messages.length, stored: 0 });
  return Response.json({ accepted: parsed.data.messages.length, stored: 0 }, { status: 202 });
}
