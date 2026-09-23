import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { serverEnv } from '@/env';

/** True when the request carries `Authorization: Bearer ${CRON_SECRET}`. */
export function isCronRequest(request: Request): boolean {
  const secret = serverEnv.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
