import 'server-only';
import { createHash } from 'node:crypto';
import { serverEnv } from '@/env';
import { decryptSecret, encryptSecret } from '@/lib/crypto';
import type { Json } from '@/lib/db/types';
import { FEED_TOKEN_PATTERN, hashFeedToken, newFeedToken } from '@/lib/ics/feed';
import { rebuildDocumentChunks } from '@/lib/notes/store';
import { extractJob } from './inbox';
import { enqueue, type Admin } from './queue';

// The Odyssey userscript's personal token (integration_tokens, provider
// odyssey_script) and what the ingest route does with the rows it posts. Same
// shape as the ICS feed token: stored encrypted so Settings can rebuild the
// script, with its sha256 in meta for the route's lookup.

const PROVIDER = 'odyssey_script';
export const ODYSSEY_KIND = 'odyssey_paste';

interface OdysseyMeta {
  token_hash?: string;
  created_at?: string;
  last_sent_at?: string;
  last_rows?: number;
  last_document_id?: string;
}

function key(): string {
  const k = serverEnv.TOKEN_ENCRYPTION_KEY;
  if (!k) throw new Error('TOKEN_ENCRYPTION_KEY is not set, so the userscript token cannot be stored.');
  return k;
}

export interface OdysseyScriptStatus {
  on: boolean;
  token: string | null;
  createdAt: string | null;
  lastSentAt: string | null;
  lastRows: number | null;
  lastDocumentId: string | null;
}

export async function odysseyScriptStatus(admin: Admin, userId: string): Promise<OdysseyScriptStatus> {
  const { data, error } = await admin
    .from('integration_tokens')
    .select('secret_ciphertext, meta')
    .eq('user_id', userId)
    .eq('provider', PROVIDER)
    .maybeSingle();
  if (error) throw new Error(`Could not read the userscript settings: ${error.message}`);
  if (!data) return { on: false, token: null, createdAt: null, lastSentAt: null, lastRows: null, lastDocumentId: null };
  const meta = (data.meta ?? {}) as OdysseyMeta;
  return {
    on: true,
    token: decryptSecret(data.secret_ciphertext, key()),
    createdAt: meta.created_at ?? null,
    lastSentAt: meta.last_sent_at ?? null,
    lastRows: meta.last_rows ?? null,
    lastDocumentId: meta.last_document_id ?? null,
  };
}

/** Makes a new token, replacing any old one (scripts with the old token stop working). */
export async function createOdysseyToken(admin: Admin, userId: string): Promise<void> {
  const token = newFeedToken();
  const meta: OdysseyMeta = { token_hash: hashFeedToken(token), created_at: new Date().toISOString() };
  const { error } = await admin.from('integration_tokens').upsert(
    { user_id: userId, provider: PROVIDER, secret_ciphertext: encryptSecret(token, key()), meta: meta as Json, status: 'ok' },
    { onConflict: 'user_id,provider' },
  );
  if (error) throw new Error(`Could not save the userscript token: ${error.message}`);
}

export async function deleteOdysseyToken(admin: Admin, userId: string): Promise<void> {
  const { error } = await admin.from('integration_tokens').delete().eq('user_id', userId).eq('provider', PROVIDER);
  if (error) throw new Error(`Could not turn off the userscript: ${error.message}`);
}

export interface OdysseyTokenOwner {
  rowId: string;
  userId: string;
  meta: OdysseyMeta;
}

/** The owner of a userscript token, or null. Anything not shaped like a token is refused before a lookup. */
export async function ownerOfOdysseyToken(admin: Admin, token: string): Promise<OdysseyTokenOwner | null> {
  if (!FEED_TOKEN_PATTERN.test(token)) return null;
  const { data, error } = await admin
    .from('integration_tokens')
    .select('id, user_id, meta')
    .eq('provider', PROVIDER)
    .eq('meta->>token_hash', hashFeedToken(token))
    .maybeSingle();
  if (error) throw new Error(`Could not look up the token: ${error.message}`);
  if (!data) return null;
  return { rowId: data.id, userId: data.user_id, meta: (data.meta ?? {}) as OdysseyMeta };
}

export type OdysseyIngestResult = { status: 'stored'; documentId: string } | { status: 'duplicate'; documentId: string };

/**
 * Stores the rows as an Odyssey paste (no course: rows name their course) and
 * queues the same extraction a pasted table gets. A table identical to one
 * already stored, pasted or sent, changes nothing.
 */
export async function ingestOdysseyRows(
  admin: Admin,
  owner: OdysseyTokenOwner,
  input: { text: string; rows: number; pageUrl: string | null },
  now = new Date(),
): Promise<OdysseyIngestResult> {
  const hash = createHash('sha256').update(input.text, 'utf8').digest('hex');
  const { data: existing, error: findErr } = await admin
    .from('documents')
    .select('id')
    .eq('user_id', owner.userId)
    .eq('kind', ODYSSEY_KIND)
    .eq('content_hash', hash)
    .limit(1)
    .maybeSingle();
  if (findErr) throw new Error(`Could not check for the same rows: ${findErr.message}`);

  let result: OdysseyIngestResult;
  if (existing) {
    result = { status: 'duplicate', documentId: existing.id };
  } else {
    const { data: saved, error } = await admin
      .from('documents')
      .insert({
        user_id: owner.userId,
        course_id: null,
        kind: ODYSSEY_KIND,
        title: `Odyssey exams, ${input.rows} ${input.rows === 1 ? 'row' : 'rows'}`,
        raw_text: input.text,
        content_hash: hash,
        source_url: input.pageUrl,
        meta: { declared_kind: ODYSSEY_KIND, via: 'userscript' } as Json,
      })
      .select('id')
      .single();
    if (error) throw new Error(`Could not store the rows: ${error.message}`);
    await rebuildDocumentChunks(admin, {
      id: saved.id,
      user_id: owner.userId,
      course_id: null,
      kind: 'other',
      raw_text: input.text,
      source_ref: null,
    }).catch((e) => console.error(e));
    await enqueue(admin, extractJob(owner.userId, saved.id));
    result = { status: 'stored', documentId: saved.id };
  }

  const meta: OdysseyMeta = { ...owner.meta, last_sent_at: now.toISOString(), last_rows: input.rows, last_document_id: result.documentId };
  await admin.from('integration_tokens').update({ meta: meta as Json }).eq('id', owner.rowId);
  return result;
}
