import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/db/server';
import { isAllowedEmail } from '@/lib/auth/allowed';

// Google sends Dylan back here through Supabase Auth with ?code=... (PKCE).
// This route is the sign-in itself, so it doesn't call requireUser().
const querySchema = z.object({ code: z.string().min(1) });

function toLogin(request: NextRequest, error: 'private' | 'failed') {
  const url = new URL('/login', request.url);
  url.searchParams.set('error', error);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({ code: request.nextUrl.searchParams.get('code') ?? undefined });
  if (!parsed.success) return toLogin(request, 'failed');

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(parsed.data.code);
  if (error || !data.user) return toLogin(request, 'failed');

  if (!isAllowedEmail(data.user.email)) {
    await supabase.auth.signOut();
    return toLogin(request, 'private');
  }

  return NextResponse.redirect(new URL('/', request.url));
}
