import 'server-only';
import { serverEnv } from '@/env';
import { verifySignature } from './verify';

/**
 * Reads and verifies a bridge request. Returns the raw body, or a 401 response
 * that says nothing about why (the reason goes to the server log only).
 */
export async function readSignedRequest(request: Request): Promise<{ body: string } | { response: Response }> {
  const body = request.method === 'GET' ? '' : await request.text();
  const result = verifySignature({
    secret: serverEnv.INGEST_WEBHOOK_SECRET,
    timestamp: request.headers.get('x-runway-timestamp'),
    signature: request.headers.get('x-runway-signature'),
    body,
  });
  if (!result.ok) {
    console.warn(`signed request rejected: ${new URL(request.url).pathname}: ${result.reason}`);
    return { response: new Response('Unauthorized', { status: 401 }) };
  }
  return { body };
}
