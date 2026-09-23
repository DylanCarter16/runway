import { serverEnv } from '@/env';
import { createAdminClient } from '@/lib/db/admin';
import { ownerOfMcpToken } from '@/lib/jobs/mcp';
import { mcpData } from '@/lib/mcp/data';
import { handleMcpPost } from '@/lib/mcp/server';

// Read-only MCP endpoint (Phase 8): POST /api/mcp/<token>, Streamable HTTP without
// sessions or server-sent events. The secret token in the path is the credential,
// because claude.ai custom connectors take only a URL. Unknown tokens get a plain
// 404 so the route says nothing about which exist.

export const dynamic = 'force-dynamic';

const MAX_BODY = 100_000;
const HEADERS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

function notFound() {
  return new Response('Not found', { status: 404, headers: HEADERS });
}

export async function POST(request: Request, ctx: RouteContext<'/api/mcp/[token]'>) {
  const { token } = await ctx.params;
  const admin = createAdminClient();
  const userId = await ownerOfMcpToken(admin, token, request.headers.get('user-agent'));
  if (!userId) return notFound();

  const text = await request.text();
  if (text.length > MAX_BODY) return Response.json({ error: 'Request too large' }, { status: 413, headers: HEADERS });
  const answer = await handleMcpPost(text, { data: mcpData(admin, userId), appUrl: serverEnv.APP_URL.replace(/\/$/, ''), now: new Date() });
  if (answer.body === null) return new Response(null, { status: answer.status, headers: HEADERS });
  return Response.json(answer.body, { status: answer.status, headers: HEADERS });
}

/** No server-sent event stream and no sessions, so GET and DELETE are refused as the spec allows. */
function notAllowed() {
  return new Response('Method not allowed', { status: 405, headers: { ...HEADERS, Allow: 'POST' } });
}

export const GET = notAllowed;
export const DELETE = notAllowed;
