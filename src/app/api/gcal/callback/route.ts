import { timingSafeEqual } from 'node:crypto';
import { after, NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/db/server';
import { GCAL_STATE_COOKIE } from '@/lib/gcal/google';
import { connectGoogle } from '@/lib/jobs/gcal';
import { runWorkerNow } from '@/lib/jobs/schedule';

// Google sends Dylan back here after consent. Checks the state cookie, stores the
// refresh token encrypted, creates the Runway calendar, and starts the first sync.

export const maxDuration = 60;

const querySchema = z.union([
  z.object({ code: z.string().min(1).max(2000), state: z.string().min(1).max(200) }),
  z.object({ error: z.string().max(200) }),
]);

function back(request: NextRequest, result: string) {
  const response = NextResponse.redirect(new URL(`/settings/integrations?gcal=${result}`, request.url));
  response.cookies.delete({ name: GCAL_STATE_COOKIE, path: '/api/gcal' });
  return response;
}

function sameState(a: string, b: string | undefined): boolean {
  if (!b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(request: NextRequest) {
  let userId: string;
  try {
    userId = (await requireUser()).id;
  } catch {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return back(request, 'error');
  if ('error' in parsed.data) return back(request, parsed.data.error === 'access_denied' ? 'denied' : 'error');
  if (!sameState(parsed.data.state, request.cookies.get(GCAL_STATE_COOKIE)?.value)) return back(request, 'expired');

  try {
    const redirectUri = new URL('/api/gcal/callback', request.nextUrl.origin).toString();
    await connectGoogle(userId, parsed.data.code, redirectUri);
  } catch (e) {
    console.error('gcal connect failed:', e instanceof Error ? e.message : e);
    return back(request, 'error');
  }
  after(runWorkerNow);
  return back(request, 'connected');
}
