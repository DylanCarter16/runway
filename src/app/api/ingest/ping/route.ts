import { z } from 'zod';
import { createAdminClient } from '@/lib/db/admin';
import { ownerUserId, recordBridgeContact } from '@/lib/digest/load';
import { readSignedRequest } from '@/lib/ingest/request';

// The Apps Script bridge's setup() pings here; Settings, Integrations shows the last ping.

const bodySchema = z.object({ at: z.string().max(40).optional() });

export async function POST(request: Request) {
  const signed = await readSignedRequest(request);
  if ('response' in signed) return signed.response;
  let body: unknown;
  try {
    body = JSON.parse(signed.body || '{}');
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return new Response('Bad body', { status: 400 });
  const admin = createAdminClient();
  const userId = await ownerUserId(admin);
  if (!userId) return new Response('No account yet', { status: 404 });
  await recordBridgeContact(admin, userId, { kind: 'ping', at: parsed.data.at ?? null });
  return Response.json({ ok: true });
}
