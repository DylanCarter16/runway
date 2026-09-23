import { describe, expect, it } from 'vitest';
import { signBody, verifySignature } from '@/lib/ingest/verify';

const secret = 'test-secret-not-real';
const now = new Date('2026-09-23T12:00:00Z');
const ts = String(Math.floor(now.getTime() / 1000));

describe('verifySignature', () => {
  it('accepts a body signed the way Code.gs signs it, including the empty GET body', () => {
    // Code.gs sends ASCII-only JSON with non-ASCII escaped as \uXXXX.
    const body = '{"source":"piazza","messages":[{"id":"m1","subject":"Caf\u00e9"}]}';
    expect(verifySignature({ secret, timestamp: ts, signature: signBody(secret, ts, body), body, now })).toEqual({ ok: true });
    expect(verifySignature({ secret, timestamp: ts, signature: signBody(secret, ts, ''), body: '', now })).toEqual({ ok: true });
  });

  it('rejects a changed body, a wrong secret, and missing headers', () => {
    const sig = signBody(secret, ts, '{"a":1}');
    expect(verifySignature({ secret, timestamp: ts, signature: sig, body: '{"a":2}', now }).ok).toBe(false);
    expect(verifySignature({ secret: 'other', timestamp: ts, signature: sig, body: '{"a":1}', now }).ok).toBe(false);
    expect(verifySignature({ secret, timestamp: null, signature: sig, body: '{"a":1}', now }).ok).toBe(false);
    expect(verifySignature({ secret, timestamp: ts, signature: null, body: '{"a":1}', now }).ok).toBe(false);
    expect(verifySignature({ secret: undefined, timestamp: ts, signature: sig, body: '{"a":1}', now }).ok).toBe(false);
  });

  it('rejects timestamps more than 5 minutes old or ahead', () => {
    const old = String(Number(ts) - 301);
    const ahead = String(Number(ts) + 301);
    const edge = String(Number(ts) - 300);
    expect(verifySignature({ secret, timestamp: old, signature: signBody(secret, old, ''), body: '', now })).toEqual({
      ok: false,
      reason: 'Timestamp too old.',
    });
    expect(verifySignature({ secret, timestamp: ahead, signature: signBody(secret, ahead, ''), body: '', now }).ok).toBe(false);
    expect(verifySignature({ secret, timestamp: edge, signature: signBody(secret, edge, ''), body: '', now }).ok).toBe(true);
  });
});
