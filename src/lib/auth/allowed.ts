import { serverEnv } from '@/env';

/** Shown on /login when a Google account other than ALLOWED_EMAIL signs in. */
export const PRIVATE_MESSAGE = 'This app is private.';

/** True only for ALLOWED_EMAIL (case and surrounding spaces ignored). */
export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === serverEnv.ALLOWED_EMAIL.trim().toLowerCase();
}
