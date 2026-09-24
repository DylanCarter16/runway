import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/db/proxy';
import { isAllowedEmail } from '@/lib/auth/allowed';

export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const { pathname } = request.nextUrl;
  const isLoginPage = pathname === '/login';
  // The Google sign-in callback runs before there is a session.
  const isAuthCallback = pathname === '/auth/callback';
  // Privacy and terms are public (Google's OAuth consent screen links to them).
  const isPublic = pathname === '/privacy' || pathname === '/terms';
  // A session for any account other than ALLOWED_EMAIL counts as signed out.
  const signedIn = user !== null && isAllowedEmail(user.email);

  if (!signedIn && !isLoginPage && !isPublic && !isAuthCallback) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = user ? '?error=private' : '';
    return NextResponse.redirect(url);
  }

  if (signedIn && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // The PWA files (manifest, service worker, icons, offline page) load before sign-in.
    '/((?!api/cron|api/jobs|api/ingest|api/digest|api/feed|api/mcp|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|offline.html|icons/).*)',
  ],
};
