import { describe, expect, it } from 'vitest';
import { handleMcpPost, MCP_TOOL_NAMES, type McpContext } from '@/lib/mcp/server';
import { A1, CS_NOTE, CS_NOTE_BODY, CS_SECRET, fakeData, LOOSE_NOTE, MIDTERM, STAT_NOTE } from './fake-data';

const NOW = new Date('2026-09-23T16:00:00Z'); // noon in Toronto

function ctx(data = fakeData()): McpContext {
  return { data, appUrl: 'https://runway.test', now: NOW };
}

async function rpc(method: string, params?: Record<string, unknown>, c = ctx()) {
  const answer = await handleMcpPost(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), c);
  expect(answer.status).toBe(200);
  return answer.body as { result?: Record<string, unknown>; error?: { code: number; message: string } };
}

async function call(name: string, args: Record<string, unknown> = {}, c = ctx()) {
  const { result, error } = await rpc('tools/call', { name, arguments: args }, c);
  expect(error).toBeUndefined();
  const r = result as { content: { type: string; text: string }[]; isError?: boolean };
  const text = r.content[0].text;
  return { text, isError: r.isError ?? false, json: r.isError ? null : JSON.parse(text) };
}

describe('MCP protocol', () => {
  it('initializes with the asked version when supported, else the newest', async () => {
    const asked = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    expect(asked.result).toMatchObject({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'runway' } });
    const odd = await rpc('initialize', { protocolVersion: '1999-01-01' });
    expect(odd.result?.protocolVersion).toBe('2025-11-25');
  });

  it('answers notifications with 202 and no body', async () => {
    const answer = await handleMcpPost(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), ctx());
    expect(answer).toEqual({ status: 202, body: null });
  });

  it('answers ping, and errors for unknown methods, unknown tools, bad JSON, and bad messages', async () => {
    expect((await rpc('ping')).result).toEqual({});
    expect((await rpc('resources/list')).error?.code).toBe(-32601);
    expect((await rpc('tools/call', { name: 'delete_everything' })).error?.code).toBe(-32602);
    const bad = await handleMcpPost('{not json', ctx());
    expect(bad.status).toBe(400);
    expect((bad.body as { error: { code: number } }).error.code).toBe(-32700);
    const wrong = await handleMcpPost(JSON.stringify({ id: 1, method: 'ping' }), ctx());
    expect((wrong.body as { error: { code: number } }).error.code).toBe(-32600);
  });

  it('answers a batch, leaving out its notifications', async () => {
    const answer = await handleMcpPost(
      JSON.stringify([
        { jsonrpc: '2.0', id: 'a', method: 'ping' },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 'b', method: 'tools/list' },
      ]),
      ctx(),
    );
    expect(answer.status).toBe(200);
    expect((answer.body as { id: string }[]).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('lists six read-only tools with JSON schemas', async () => {
    const { result } = await rpc('tools/list');
    const tools = result?.tools as { name: string; inputSchema: { type: string }; annotations: { readOnlyHint: boolean } }[];
    expect(tools.map((t) => t.name)).toEqual(MCP_TOOL_NAMES);
    expect(MCP_TOOL_NAMES).toEqual(['list_courses', 'list_deadlines', 'search', 'get_item', 'list_notes', 'get_note']);
    for (const t of tools) {
      expect(t.inputSchema.type).toBe('object');
      expect(t.annotations.readOnlyHint).toBe(true);
    }
  });
});

describe('MCP tools', () => {
  it('list_deadlines covers the next 14 days in Toronto time and leaves out submitted work', async () => {
    const { json } = await call('list_deadlines');
    expect(json.range).toEqual({ from: '2026-09-23', to: '2026-10-06', time_zone: 'America/Toronto' });
    expect(json.items.map((i: { title: string }) => i.title)).toEqual(['A1']);
    expect(json.items[0]).toMatchObject({ course: 'CS 251', due: { date: '2026-10-03', time: '22:00' }, runway_url: `https://runway.test/items/${A1}` });

    const done = await call('list_deadlines', { include_done: true });
    expect(done.json.items.map((i: { title: string }) => i.title)).toEqual(['A0', 'A1']);
  });

  it('list_deadlines filters by course and keeps local times across the DST change', async () => {
    const { json } = await call('list_deadlines', { course: 'stat 230', from: '2026-10-01', days: 60 });
    expect(json.items.map((i: { title: string }) => i.title)).toEqual(['STAT 230 Midterm 1', 'Quiz 2']);
    expect(json.items[0].starts).toMatchObject({ date: '2026-10-08', time: '19:00' });
    expect(json.items[1].due).toMatchObject({ date: '2026-11-06', time: '15:30' });
  });

  it('shows date-only items without a time', async () => {
    const { json } = await call('list_deadlines', { from: '2026-10-10', days: 1 });
    expect(json.items[0]).toMatchObject({ title: 'Reading week', course: null, starts: { date: '2026-10-10', time: null } });
    expect(json.items[0].description).toBeUndefined();
  });

  it('refuses unknown courses and bad arguments as tool errors', async () => {
    const unknown = await call('list_deadlines', { course: 'MATH 999' });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain('STAT 230, CS 251');
    const bad = await call('list_deadlines', { days: 0 });
    expect(bad.isError).toBe(true);
    expect((await call('get_item', { id: 'not-a-uuid' })).isError).toBe(true);
  });

  it('get_item includes the description only for courses with AI on', async () => {
    const stat = await call('get_item', { id: MIDTERM });
    expect(stat.json).toMatchObject({ location: 'M3 1006', seat: '57', weight_percent: 25, description: 'Covers chapters 1 to 4' });
    const cs = await call('get_item', { id: A1 });
    expect(cs.json).toMatchObject({ title: 'A1', course: 'CS 251', source: expect.any(String) });
    expect(cs.text).not.toContain(CS_SECRET);
  });

  it('search expands course codes and assessment names', async () => {
    const data = fakeData();
    const { json, text } = await call('search', { query: 'cs251 a1' }, ctx(data));
    expect(data.calls).toContain('searchItems A1');
    expect(json.items.map((i: { id: string }) => i.id)).toEqual([A1]);
    expect(json.notes).toEqual([]);
    expect(text).not.toContain(CS_SECRET);
    expect(data.calls.some((c) => c.startsWith('searchNotes'))).toBe(false);
  });

  it('search returns notes only from courses with AI on, even when the data layer leaks', async () => {
    const { json, text } = await call('search', { query: 'graphs' }, ctx(fakeData({ leaky: true })));
    expect(json.notes).toEqual([]);
    expect(text).not.toContain(CS_NOTE);
    expect(text).not.toContain(LOOSE_NOTE);
    expect(json.note).toContain('CS 251');
    const stat = await call('search', { query: 'independent' });
    expect(stat.json.notes.map((n: { id: string }) => n.id)).toEqual([STAT_NOTE]);
  });

  it('list_notes lists AI-on courses only and refuses an AI-off course', async () => {
    const data = fakeData({ leaky: true });
    const { json } = await call('list_notes', {}, ctx(data));
    expect(json.notes.map((n: { id: string }) => n.id)).toEqual([STAT_NOTE]);
    const off = await call('list_notes', { course: 'cs251' }, ctx(data));
    expect(off.isError).toBe(true);
    expect(off.text).toContain('CS 251 has AI turned off');
  });

  it('get_note returns the text for STAT 230 and refuses CS 251 and course-less notes', async () => {
    const stat = await call('get_note', { id: STAT_NOTE });
    expect(stat.json.markdown).toContain('P(A \\cap B)');
    expect(stat.json.runway_url).toBe(`https://runway.test/notes/${STAT_NOTE}`);
    const cs = await call('get_note', { id: CS_NOTE });
    expect(cs.isError).toBe(true);
    expect(cs.text).not.toContain(CS_NOTE_BODY);
    expect((await call('get_note', { id: LOOSE_NOTE })).isError).toBe(true);
  });

  it('list_courses shows the AI switch per course', async () => {
    const { json } = await call('list_courses');
    expect(json.map((c: { code: string; ai_allowed: boolean }) => [c.code, c.ai_allowed])).toEqual([
      ['STAT 230', true],
      ['CS 251', false],
    ]);
  });
});
