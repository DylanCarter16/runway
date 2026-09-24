import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const state = vi.hoisted(() => ({ user: null as { email?: string } | null }));

vi.mock('@/env', () => ({ serverEnv: { ALLOWED_EMAIL: 'dylan@example.com' } }));
vi.mock('@/lib/db/proxy', () => ({
  updateSession: async () => ({ response: NextResponse.next(), user: state.user }),
}));

const { proxy } = await import('@/proxy');

async function visit(path: string) {
  const res = await proxy(new NextRequest(`https://runway.test${path}`));
  return res.headers.get('location');
}

beforeEach(() => {
  state.user = null;
});

describe('proxy', () => {
  it('lets a signed-out visit reach /login and /auth/callback', async () => {
    expect(await visit('/login')).toBeNull();
    expect(await visit('/auth/callback?code=abc')).toBeNull();
  });

  it('sends signed-out visits to /login', async () => {
    expect(await visit('/inbox')).toBe('https://runway.test/login');
  });

  it('lets ALLOWED_EMAIL in and away from /login', async () => {
    state.user = { email: 'Dylan@example.com' };
    expect(await visit('/inbox')).toBeNull();
    expect(await visit('/login')).toBe('https://runway.test/');
  });

  it('treats another account as signed out, with the private message', async () => {
    state.user = { email: 'someone@gmail.com' };
    expect(await visit('/inbox')).toBe('https://runway.test/login?error=private');
    expect(await visit('/login?error=private')).toBeNull();
  });
});
