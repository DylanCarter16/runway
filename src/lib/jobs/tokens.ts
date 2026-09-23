import 'server-only';
import { serverEnv } from '@/env';
import { decryptSecret, encryptSecret } from '@/lib/crypto';
import type { Json } from '@/lib/db/types';
import type { Admin } from './queue';

// integration_tokens is server-only (RLS on, no policies), so reads and writes go
// through the service role. The LEARN feed URL holds a private token: it is stored
// encrypted and never returned to the browser or written to a log.

function key(): string {
  const k = serverEnv.TOKEN_ENCRYPTION_KEY;
  if (!k) throw new Error('TOKEN_ENCRYPTION_KEY is not set, so secrets cannot be stored.');
  return k;
}

export interface LearnFeedStatus {
  saved: boolean;
  host: string | null;
  savedAt: string | null;
  status: string | null;
}

export async function saveLearnFeedUrl(admin: Admin, userId: string, url: string): Promise<void> {
  const { error } = await admin.from('integration_tokens').upsert(
    {
      user_id: userId,
      provider: 'learn_ics',
      secret_ciphertext: encryptSecret(url, key()),
      meta: { host: new URL(url).host, saved_at: new Date().toISOString() },
      status: 'ok',
    },
    { onConflict: 'user_id,provider' },
  );
  if (error) throw new Error(`Could not save the feed URL: ${error.message}`);
}

export async function deleteLearnFeedUrl(admin: Admin, userId: string): Promise<void> {
  const { error } = await admin.from('integration_tokens').delete().eq('user_id', userId).eq('provider', 'learn_ics');
  if (error) throw new Error(`Could not remove the feed URL: ${error.message}`);
}

export async function learnFeedStatus(admin: Admin, userId: string): Promise<LearnFeedStatus> {
  const { data } = await admin
    .from('integration_tokens')
    .select('meta, status')
    .eq('user_id', userId)
    .eq('provider', 'learn_ics')
    .maybeSingle();
  const meta = (data?.meta ?? {}) as { host?: string; saved_at?: string };
  return { saved: Boolean(data), host: meta.host ?? null, savedAt: meta.saved_at ?? null, status: data?.status ?? null };
}

export interface LearnFeed {
  url: string;
  meta: Record<string, unknown>;
}

export async function readLearnFeed(admin: Admin, userId: string): Promise<LearnFeed | null> {
  const { data, error } = await admin
    .from('integration_tokens')
    .select('secret_ciphertext, meta')
    .eq('user_id', userId)
    .eq('provider', 'learn_ics')
    .maybeSingle();
  if (error) throw new Error(`Could not read the LEARN feed settings: ${error.message}`);
  if (!data) return null;
  return { url: decryptSecret(data.secret_ciphertext, key()), meta: (data.meta ?? {}) as Record<string, unknown> };
}

export async function updateLearnFeedMeta(admin: Admin, userId: string, meta: Record<string, unknown>, status: 'ok' | 'error') {
  await admin
    .from('integration_tokens')
    .update({ meta: meta as Json, status })
    .eq('user_id', userId)
    .eq('provider', 'learn_ics');
}
