'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/db/server';
import { serverEnv } from '@/env';

/**
 * Starts Google sign-in through Supabase Auth. The PKCE code verifier is saved as a cookie
 * on this host, so the callback URL uses the same origin the button was pressed on.
 * /auth/callback exchanges the code and applies the ALLOWED_EMAIL gate.
 */
export async function continueWithGoogle(): Promise<void> {
  const origin = (await headers()).get('origin') ?? serverEnv.APP_URL;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: new URL('/auth/callback', origin).toString(),
      // Always show the account picker, so a phone signed in to another Google account can switch.
      queryParams: { prompt: 'select_account' },
    },
  });

  if (error || !data.url) {
    redirect('/login?error=failed');
  }

  redirect(data.url);
}
