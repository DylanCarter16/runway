import 'server-only';
import { serverEnv } from '@/env';
import { decryptSecret, encryptSecret } from '@/lib/crypto';
import type { Json } from '@/lib/db/types';
import { FEED_TOKEN_PATTERN, hashFeedToken, newFeedToken } from '@/lib/ics/feed';
import type { Admin } from './queue';

// The MCP connector's token (integration_tokens, provider mcp). Same shape as the
// ICS feed token: stored encrypted so Settings can show the URL again, with its
// sha256 in meta for the route's lookup. The token sits in the URL path because
// claude.ai custom connectors take a URL and nothing else.

const PROVIDER = 'mcp';
/** Use is recorded at most this often, so a chat calling several tools writes once. */
const USE_RECORD_MS = 5 * 60_000;

interface McpMeta {
  token_hash?: string;
  created_at?: string;
  last_used_at?: string;
  last_used_by?: string;
}

function key(): string {
  const k = serverEnv.TOKEN_ENCRYPTION_KEY;
  if (!k) throw new Error('TOKEN_ENCRYPTION_KEY is not set, so the connector link cannot be stored.');
  return k;
}

/** `/api/mcp/<token>` on the app's origin. */
export function mcpUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, '')}/api/mcp/${token}`;
}

export interface McpStatus {
  on: boolean;
  url: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
  lastUsedBy: string | null;
}

export async function mcpStatus(admin: Admin, userId: string): Promise<McpStatus> {
  const { data, error } = await admin
    .from('integration_tokens')
    .select('secret_ciphertext, meta')
    .eq('user_id', userId)
    .eq('provider', PROVIDER)
    .maybeSingle();
  if (error) throw new Error(`Could not read the connector settings: ${error.message}`);
  if (!data) return { on: false, url: null, createdAt: null, lastUsedAt: null, lastUsedBy: null };
  const meta = (data.meta ?? {}) as McpMeta;
  return {
    on: true,
    url: mcpUrl(serverEnv.APP_URL, decryptSecret(data.secret_ciphertext, key())),
    createdAt: meta.created_at ?? null,
    lastUsedAt: meta.last_used_at ?? null,
    lastUsedBy: meta.last_used_by ?? null,
  };
}

/** Makes a new token, replacing any old one (connectors with the old URL stop working). */
export async function createMcpToken(admin: Admin, userId: string): Promise<void> {
  const token = newFeedToken();
  const meta: McpMeta = { token_hash: hashFeedToken(token), created_at: new Date().toISOString() };
  const { error } = await admin.from('integration_tokens').upsert(
    { user_id: userId, provider: PROVIDER, secret_ciphertext: encryptSecret(token, key()), meta: meta as Json, status: 'ok' },
    { onConflict: 'user_id,provider' },
  );
  if (error) throw new Error(`Could not save the connector link: ${error.message}`);
}

export async function deleteMcpToken(admin: Admin, userId: string): Promise<void> {
  const { error } = await admin.from('integration_tokens').delete().eq('user_id', userId).eq('provider', PROVIDER);
  if (error) throw new Error(`Could not turn off the connector: ${error.message}`);
}

/**
 * The owner of a connector token, or null. Records when (and by which client) it
 * was last used, at most every five minutes.
 */
export async function ownerOfMcpToken(admin: Admin, token: string, userAgent: string | null, now = new Date()): Promise<string | null> {
  if (!FEED_TOKEN_PATTERN.test(token)) return null;
  const { data, error } = await admin
    .from('integration_tokens')
    .select('id, user_id, meta')
    .eq('provider', PROVIDER)
    .eq('meta->>token_hash', hashFeedToken(token))
    .maybeSingle();
  if (error) throw new Error(`Could not look up the connector: ${error.message}`);
  if (!data) return null;
  const meta = (data.meta ?? {}) as McpMeta;
  const last = meta.last_used_at ? Date.parse(meta.last_used_at) : 0;
  if (now.getTime() - last >= USE_RECORD_MS) {
    const next: McpMeta = { ...meta, last_used_at: now.toISOString(), last_used_by: userAgent?.slice(0, 120) ?? undefined };
    await admin.from('integration_tokens').update({ meta: next as Json }).eq('id', data.id);
  }
  return data.user_id;
}
