import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/db/proxy';

export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const { pathname } = request.nextUrl;
  const isLoginPage = pathname === '/login';
  // Privacy and terms are public (Google's OAuth consent screen links to them).
  const isPublic = pathname === '/privacy' || pathname === '/terms';

  if (!user && !isLoginPage && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (user && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
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
