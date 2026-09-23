import 'server-only';
import { serverEnv } from '@/env';
import { decryptSecret, encryptSecret } from '@/lib/crypto';
import type { Json } from '@/lib/db/types';
import { FEED_TOKEN_PATTERN, feedUrl, hashFeedToken, newFeedToken } from '@/lib/ics/feed';
import type { Admin } from './queue';

// The ICS feed token (integration_tokens, provider ics_feed). The token is stored
// encrypted so Settings can show the URL again, and its sha256 sits in meta so the
// public feed route can find the owner without decrypting every row.

const PROVIDER = 'ics_feed';
/** Fetch times are recorded at most this often, so a polling calendar app doesn't write on every request. */
const FETCH_RECORD_MS = 5 * 60_000;

interface FeedMeta {
  token_hash?: string;
  created_at?: string;
  last_fetched_at?: string;
  last_fetched_by?: string;
}

function key(): string {
  const k = serverEnv.TOKEN_ENCRYPTION_KEY;
  if (!k) throw new Error('TOKEN_ENCRYPTION_KEY is not set, so the feed link cannot be stored.');
  return k;
}

export interface FeedStatus {
  on: boolean;
  url: string | null;
  createdAt: string | null;
  lastFetchedAt: string | null;
  lastFetchedBy: string | null;
}

export async function feedStatus(admin: Admin, userId: string): Promise<FeedStatus> {
  const { data, error } = await admin
    .from('integration_tokens')
    .select('secret_ciphertext, meta')
    .eq('user_id', userId)
    .eq('provider', PROVIDER)
    .maybeSingle();
  if (error) throw new Error(`Could not read the feed settings: ${error.message}`);
  if (!data) return { on: false, url: null, createdAt: null, lastFetchedAt: null, lastFetchedBy: null };
  const meta = (data.meta ?? {}) as FeedMeta;
  return {
    on: true,
    url: feedUrl(serverEnv.APP_URL, decryptSecret(data.secret_ciphertext, key())),
    createdAt: meta.created_at ?? null,
    lastFetchedAt: meta.last_fetched_at ?? null,
    lastFetchedBy: meta.last_fetched_by ?? null,
  };
}

/** Makes a new token, replacing any old one (the old URL stops working). */
export async function createFeedToken(admin: Admin, userId: string): Promise<void> {
  const token = newFeedToken();
  const meta: FeedMeta = { token_hash: hashFeedToken(token), created_at: new Date().toISOString() };
  const { error } = await admin.from('integration_tokens').upsert(
    {
      user_id: userId,
      provider: PROVIDER,
      secret_ciphertext: encryptSecret(token, key()),
      meta: meta as Json,
      status: 'ok',
    },
    { onConflict: 'user_id,provider' },
  );
  if (error) throw new Error(`Could not save the feed link: ${error.message}`);
}

export async function deleteFeedToken(admin: Admin, userId: string): Promise<void> {
  const { error } = await admin.from('integration_tokens').delete().eq('user_id', userId).eq('provider', PROVIDER);
  if (error) throw new Error(`Could not turn off the feed: ${error.message}`);
}

/**
 * The owner of a feed token, or null. Records when (and by which app) the feed was
 * last fetched, at most every five minutes.
 */
export async function ownerOfFeedToken(admin: Admin, token: string, userAgent: string | null, now = new Date()): Promise<string | null> {
  if (!FEED_TOKEN_PATTERN.test(token)) return null;
  const { data, error } = await admin
    .from('integration_tokens')
    .select('id, user_id, meta')
    .eq('provider', PROVIDER)
    .eq('meta->>token_hash', hashFeedToken(token))
    .maybeSingle();
  if (error) throw new Error(`Could not look up the feed: ${error.message}`);
  if (!data) return null;
  const meta = (data.meta ?? {}) as FeedMeta;
  const last = meta.last_fetched_at ? Date.parse(meta.last_fetched_at) : 0;
  if (now.getTime() - last >= FETCH_RECORD_MS) {
    const next: FeedMeta = { ...meta, last_fetched_at: now.toISOString(), last_fetched_by: userAgent?.slice(0, 120) ?? undefined };
    await admin.from('integration_tokens').update({ meta: next as Json }).eq('id', data.id);
  }
  return data.user_id;
}
