'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/db/server';
import { serverEnv } from '@/env';

type ActionResult = { ok: true } | { ok: false; error: string };

const PRIVATE_MESSAGE = 'This app is private.';

export async function requestCode(email: string): Promise<ActionResult> {
  const normalized = email.trim().toLowerCase();

  // Checked before Supabase is ever called, so addresses other than
  // ALLOWED_EMAIL never use up the 2-per-hour sender allowance.
  if (normalized !== serverEnv.ALLOWED_EMAIL.toLowerCase()) {
    return { ok: false, error: PRIVATE_MESSAGE };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: normalized,
    options: { shouldCreateUser: true },
  });

  if (error) {
    return { ok: false, error: 'Could not send the code. Try again.' };
  }

  return { ok: true };
}

export async function verifyCode(email: string, token: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: token.trim(),
    type: 'email',
  });

  if (error) {
    return { ok: false, error: "That code didn't work. Check it and try again." };
  }

  redirect('/');
}
