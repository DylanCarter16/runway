import { after } from 'next/server';
import { createAdminClient } from '@/lib/db/admin';
import { ingestOdysseyRows, ownerOfOdysseyToken } from '@/lib/jobs/odyssey';
import { runQueuedJobs } from '@/lib/jobs/schedule';
import { parseOdyssey } from '@/lib/sources/odyssey';
import { odysseyPostSchema, tablesToText } from '@/lib/sources/odyssey-script';

// Exam rows from the Odyssey userscript (Phase 8, SOURCES.md 8). The script runs in
// Dylan's browser, so it carries a personal token (Settings, Integrations) instead
// of the bridge's HMAC secret. The rows are stored as an Odyssey paste and go
// through the same rule-based parser, so they arrive as proposals in the Inbox.
// Every answer has a `message` the script shows on the Odyssey page.

export const dynamic = 'force-dynamic';

const MAX_BODY = 500_000;

function reply(status: number, message: string, extra: Record<string, unknown> = {}) {
  return Response.json({ message, ...extra }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const auth = request.headers.get('authorization') ?? '';
  const token = /^Bearer (\S+)$/.exec(auth)?.[1] ?? '';
  const admin = createAdminClient();
  const owner = token ? await ownerOfOdysseyToken(admin, token) : null;
  if (!owner) return reply(401, 'the token was refused. Download the script again from Runway.');

  const raw = await request.text();
  if (raw.length > MAX_BODY) return reply(413, 'that page is too big to send.');
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply(400, 'the script sent something Runway could not read.');
  }
  const parsed = odysseyPostSchema.safeParse(body);
  if (!parsed.success) return reply(400, 'the script sent something Runway could not read.');

  const text = tablesToText(parsed.data.tables);
  const rows = parseOdyssey(text).length;
  if (!rows) return reply(422, 'no exam rows on this page yet. Nothing was sent.', { rows: 0 });

  const result = await ingestOdysseyRows(admin, owner, { text, rows, pageUrl: parsed.data.pageUrl ?? null });
  if (result.status === 'duplicate') {
    return reply(200, `already up to date (${rows} exam ${rows === 1 ? 'row' : 'rows'}).`, { rows, status: 'duplicate' });
  }
  after(async () => {
    try {
      await runQueuedJobs(admin);
    } catch (e) {
      console.error('job worker failed:', e instanceof Error ? e.message : e);
    }
  });
  return reply(202, `sent ${rows} exam ${rows === 1 ? 'row' : 'rows'}. Changes show up in the Runway inbox.`, {
    rows,
    status: 'stored',
    documentId: result.documentId,
  });
}
