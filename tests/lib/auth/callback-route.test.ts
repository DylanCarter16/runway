import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  exchanged: [] as string[],
  signOuts: 0,
  result: { data: { user: null as { email?: string } | null }, error: null as Error | null },
}));

vi.mock('@/env', () => ({ serverEnv: { ALLOWED_EMAIL: 'Dylan@Example.com' } }));
vi.mock('@/lib/db/server', () => ({
  createClient: async () => ({
    auth: {
      exchangeCodeForSession: async (code: string) => {
        state.exchanged.push(code);
        return state.result;
      },
      signOut: async () => {
        state.signOuts++;
        return { error: null };
      },
    },
  }),
}));

const { GET } = await import('@/app/auth/callback/route');

function callback(query: string) {
  return GET(new NextRequest(`https://runway.test/auth/callback${query}`));
}

beforeEach(() => {
  state.exchanged = [];
  state.signOuts = 0;
  state.result = { data: { user: { email: 'dylan@example.com' } }, error: null };
});

describe('GET /auth/callback', () => {
  it('exchanges the code and sends ALLOWED_EMAIL to Today', async () => {
    const res = await callback('?code=abc123');
    expect(state.exchanged).toEqual(['abc123']);
    expect(res.headers.get('location')).toBe('https://runway.test/');
    expect(state.signOuts).toBe(0);
  });

  it('signs any other account out with the private message', async () => {
    state.result = { data: { user: { email: 'someone@gmail.com' } }, error: null };
    const res = await callback('?code=abc123');
    expect(state.signOuts).toBe(1);
    expect(res.headers.get('location')).toBe('https://runway.test/login?error=private');
  });

  it('treats a user without an email as another account', async () => {
    state.result = { data: { user: {} }, error: null };
    const res = await callback('?code=abc123');
    expect(state.signOuts).toBe(1);
    expect(res.headers.get('location')).toBe('https://runway.test/login?error=private');
  });

  it('sends a missing code back to /login without calling Supabase', async () => {
    const res = await callback('?error=access_denied');
    expect(state.exchanged).toEqual([]);
    expect(res.headers.get('location')).toBe('https://runway.test/login?error=failed');
  });

  it('sends a failed exchange back to /login', async () => {
    state.result = { data: { user: null }, error: new Error('code verifier not found') };
    const res = await callback('?code=abc123');
    expect(res.headers.get('location')).toBe('https://runway.test/login?error=failed');
    expect(state.signOuts).toBe(0);
  });
});
