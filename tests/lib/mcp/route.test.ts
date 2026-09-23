import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CS_NOTE, CS_NOTE_BODY, STAT_NOTE } from './fake-data';

// /api/mcp/<token> driven by the official MCP client, with the token lookup and the
// data layer in memory.

const TOKEN = 'a'.repeat(43);
const state = vi.hoisted(() => ({ lookups: [] as { token: string; ua: string | null }[] }));

vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({ serverEnv: { APP_URL: 'https://runway.test/' } }));
vi.mock('@/lib/db/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/jobs/mcp', () => ({
  ownerOfMcpToken: async (_admin: unknown, token: string, ua: string | null) => {
    state.lookups.push({ token, ua });
    return token === 'a'.repeat(43) ? 'user-1' : null;
  },
}));
vi.mock('@/lib/mcp/data', async () => {
  const { fakeData: make } = await import('./fake-data');
  return { mcpData: () => make() };
});

const route = await import('@/app/api/mcp/[token]/route');

/** Sends the client's requests to the route handlers instead of the network. */
async function routeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  const token = new URL(request.url).pathname.split('/').pop() ?? '';
  const ctx = { params: Promise.resolve({ token }) };
  if (request.method === 'POST') return route.POST(request, ctx as never);
  if (request.method === 'DELETE') return route.DELETE();
  return route.GET();
}

async function connect(token = TOKEN) {
  const client = new Client({ name: 'runway-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`https://runway.test/api/mcp/${token}`), { fetch: routeFetch }));
  return client;
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  return (result.content as { type: string; text: string }[])[0].text;
}

beforeEach(() => {
  state.lookups = [];
});

describe('/api/mcp/<token>', () => {
  it('works with the official MCP client: initialize, list tools, call them', async () => {
    const client = await connect();
    expect(client.getServerVersion()?.name).toBe('runway');
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('list_deadlines');

    const midterm = await client.callTool({ name: 'search', arguments: { query: 'stat230 midterm' } });
    const found = JSON.parse(textOf(midterm));
    expect(found.items[0]).toMatchObject({ title: 'STAT 230 Midterm 1', location: 'M3 1006' });
    expect(found.items[0].runway_url).toMatch(/^https:\/\/runway\.test\/items\//);

    const note = await client.callTool({ name: 'get_note', arguments: { id: STAT_NOTE } });
    expect(JSON.parse(textOf(note)).markdown).toContain('independent');

    const cs = await client.callTool({ name: 'get_note', arguments: { id: CS_NOTE } });
    expect(cs.isError).toBe(true);
    expect(textOf(cs)).not.toContain(CS_NOTE_BODY);
    await client.close();
    expect(state.lookups.every((l) => l.token === TOKEN)).toBe(true);
  });

  it('gives an unknown token a plain 404, and the client fails to connect', async () => {
    const res = await routeFetch(`https://runway.test/api/mcp/${'b'.repeat(43)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('Not found');
    await expect(connect('b'.repeat(43))).rejects.toThrow();
  });

  it('refuses GET and DELETE with 405, and huge bodies with 413', async () => {
    const get = await routeFetch(`https://runway.test/api/mcp/${TOKEN}`);
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    expect((await routeFetch(`https://runway.test/api/mcp/${TOKEN}`, { method: 'DELETE' })).status).toBe(405);
    const big = await routeFetch(`https://runway.test/api/mcp/${TOKEN}`, { method: 'POST', body: 'x'.repeat(100_001) });
    expect(big.status).toBe(413);
  });

  it('never caches answers', async () => {
    const res = await routeFetch(`https://runway.test/api/mcp/${TOKEN}`, {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
  });
});
