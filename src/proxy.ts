import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/db/proxy';

export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const { pathname } = request.nextUrl;
  const isLoginPage = pathname === '/login';

  if (!user && !isLoginPage) {
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
    '/((?!api/cron|api/jobs|api/ingest|api/digest|_next/static|_next/image|favicon.ico).*)',
  ],
};
