import { createHmac, timingSafeEqual } from 'node:crypto';

// Signed requests from the Apps Script bridge (scripts/apps-script/Code.gs):
// HMAC-SHA256 over "<timestamp>.<body>", hex, in x-runway-timestamp and
// x-runway-signature. Requests more than 5 minutes old (or ahead) are rejected.

export const MAX_SKEW_SECONDS = 5 * 60;

export function signBody(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex');
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export function verifySignature(input: {
  secret: string | undefined;
  timestamp: string | null;
  signature: string | null;
  body: string;
  now?: Date;
}): VerifyResult {
  if (!input.secret) return { ok: false, reason: 'INGEST_WEBHOOK_SECRET is not set.' };
  if (!input.timestamp || !/^\d{9,11}$/.test(input.timestamp)) return { ok: false, reason: 'Missing or bad timestamp.' };
  if (!input.signature || !/^[0-9a-f]{64}$/i.test(input.signature)) return { ok: false, reason: 'Missing or bad signature.' };
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - Number(input.timestamp)) > MAX_SKEW_SECONDS) return { ok: false, reason: 'Timestamp too old.' };
  const expected = Buffer.from(signBody(input.secret, input.timestamp, input.body), 'hex');
  const given = Buffer.from(input.signature.toLowerCase(), 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'Signature does not match.' };
  return { ok: true };
}
