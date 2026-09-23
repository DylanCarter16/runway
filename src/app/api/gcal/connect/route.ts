import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { requireUser } from '@/lib/db/server';
import { GCAL_STATE_COOKIE, googleAuthUrl, googleConfigured } from '@/lib/gcal/google';

// Starts Google OAuth for the calendar.app.created scope. The state value goes in a
// short-lived cookie and must come back unchanged to the callback.

export async function GET(request: NextRequest) {
  try {
    await requireUser();
  } catch {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  if (!googleConfigured()) {
    return NextResponse.redirect(new URL('/settings/integrations?gcal=not_configured', request.url));
  }
  const state = randomBytes(24).toString('base64url');
  const redirectUri = new URL('/api/gcal/callback', request.nextUrl.origin).toString();
  const response = NextResponse.redirect(googleAuthUrl(redirectUri, state));
  response.cookies.set(GCAL_STATE_COOKIE, state, {
    httpOnly: true,
    secure: request.nextUrl.protocol === 'https:',
    sameSite: 'lax',
    path: '/api/gcal',
    maxAge: 600,
  });
  return response;
}
