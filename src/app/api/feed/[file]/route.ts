import { createAdminClient } from '@/lib/db/admin';
import { buildIcs } from '@/lib/ics/feed';
import { ownerOfFeedToken } from '@/lib/jobs/feed';
import { plannedCalendarEvents } from '@/lib/jobs/gcal';

// Read-only ICS feed for Apple Calendar (Phase 8): GET /api/feed/<token>.ics. The
// secret token in the path is the only credential, because calendar apps can't sign
// in. Unknown tokens get a plain 404 so the route says nothing about which exist.

export const dynamic = 'force-dynamic';

function notFound() {
  return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: Request, ctx: RouteContext<'/api/feed/[file]'>) {
  const { file } = await ctx.params;
  if (!file.endsWith('.ics')) return notFound();
  const admin = createAdminClient();
  const userId = await ownerOfFeedToken(admin, file.slice(0, -'.ics'.length), request.headers.get('user-agent'));
  if (!userId) return notFound();
  const ics = buildIcs(await plannedCalendarEvents(admin, userId), new Date());
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="runway.ics"',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}
