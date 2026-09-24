import Link from 'next/link';
import { notFound } from 'next/navigation';
import { NoteStyleForm } from '@/components/app/note-style-form';
import { PiazzaMapForm, type PiazzaClassRow } from '@/components/app/piazza-map-form';
import { AskSettingsForm } from '@/components/app/ask-settings-form';
import { HybridSearchControls } from '@/components/app/hybrid-search-controls';
import { EMBED_MODEL } from '@/lib/ai/embed';
import { DEFAULT_ANSWER_STYLE, DEFAULT_NOTE_STYLE } from '@/lib/ai/prompts';
import { DEFAULT_CONTEXT_BUDGET } from '@/lib/ask/session';
import { AiSwitch } from '@/components/app/ai-switch';
import { CourseDot } from '@/components/app/course-mark';
import { LoadTermButton } from '@/components/app/settings-bits';
import { DisconnectGoogleButton, ReminderRulesForm } from '@/components/app/reminder-controls';
import { DeleteTermButton } from '@/components/app/data-controls';
import { FeedControls } from '@/components/app/feed-controls';
import { McpControls } from '@/components/app/mcp-controls';
import { OdysseyControls } from '@/components/app/odyssey-controls';
import { InstallApp } from '@/components/app/pwa';
import { LearnFeedForm, RunNowButton } from '@/components/app/sync-controls';
import { buttonVariants } from '@/components/ui/button';
import { TERM_F26 } from '@/config/term-f26';
import { serverEnv } from '@/env';
import { createAdminClient } from '@/lib/db/admin';
import { getAppContext } from '@/lib/db/queries';
import { pageRunSource } from '@/lib/jobs/sync';
import { googleStatus, parseOverrides } from '@/lib/jobs/gcal';
import { embeddingStatus } from '@/lib/jobs/embeddings';
import { feedStatus } from '@/lib/jobs/feed';
import { mcpStatus } from '@/lib/jobs/mcp';
import { odysseyScriptStatus } from '@/lib/jobs/odyssey';
import { learnFeedStatus } from '@/lib/jobs/tokens';
import { ODYSSEY_PAGE } from '@/lib/sources/odyssey-script';
import { webcalUrl } from '@/lib/ics/feed';
import type { RunTarget } from '@/lib/jobs/types';
import { ITEM_KINDS, KIND_LABEL } from '@/lib/items/labels';
import { resolveRule } from '@/lib/reminders/rules';
import { runSummary, sourceHealth, type RunRow } from '@/lib/sync/summary';
import { termDatedFilter } from '@/lib/term/range';
import { SETTINGS_SECTIONS } from '@/lib/ui';
import { formatAgo, formatListDate, fromTorontoLocal } from '@/lib/time';
import { cn } from '@/lib/utils';

export async function generateMetadata({ params }: PageProps<'/settings/[section]'>) {
  const { section } = await params;
  const label = SETTINGS_SECTIONS.find(([s]) => s === section)?.[1];
  return { title: label ? `Settings, ${label.toLowerCase()}` : 'Settings' };
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2 border-b border-rule pb-6">
      <h3 className="text-[21px] font-semibold">{title}</h3>
      {children}
    </section>
  );
}

const CADENCE_LABEL: Record<string, string> = { hourly: 'hourly', every_3h: 'every 3 hours', daily: 'daily' };

interface SyncRowProps {
  name: string;
  detail: string;
  url?: string;
  runs: RunRow[];
  target: RunTarget | null;
  idle: string | null;
}

function SyncRow({ name, detail, url, runs, target, idle, now }: SyncRowProps & { now: Date }) {
  const { last, lastOk, failStreak } = sourceHealth(runs);
  const running = last && !last.finished_at;
  return (
    <li className="grid gap-1 py-3 sm:grid-cols-[1fr_auto] sm:items-start sm:gap-4">
      <div className="grid gap-0.5 text-sm">
        <span className="font-semibold">
          {url ? (
            <a href={url} target="_blank" rel="noopener noreferrer" className="text-link underline-offset-2 hover:underline">
              {name}
            </a>
          ) : (
            name
          )}
        </span>
        <span className="text-muted-foreground">{detail}</span>
        {idle ? <span className="text-muted-foreground">{idle}</span> : null}
        {last ? (
          <span>
            {running ? 'Running now' : last.ok ? 'OK' : 'Failed'}, {formatAgo(new Date(last.finished_at ?? last.started_at), now)}
            {last.ok ? `. ${runSummary(last.stats)}` : ''}
          </span>
        ) : idle ? null : (
          <span className="text-muted-foreground">Not run yet</span>
        )}
        {last && last.ok === false && last.error ? <span className="text-late">{last.error}</span> : null}
        {failStreak >= 3 ? <span className="font-semibold text-late">Failed {failStreak} times in a row.</span> : null}
        {last && !last.ok && lastOk?.finished_at ? (
          <span className="text-muted-foreground">Last worked {formatAgo(new Date(lastOk.finished_at), now)}</span>
        ) : null}
      </div>
      {target ? <RunNowButton target={target} /> : null}
    </li>
  );
}

const PURPOSE_LABEL: Record<string, string> = {
  classify: 'Detecting paste kinds',
  extract_outline: 'Outlines',
  extract_announcement: 'Announcements',
  extract_piazza: 'Piazza emails',
  extract_quest: 'Quest schedules',
  extract_odyssey: 'Odyssey rows',
  extract_assignment_header: 'Assignment headers',
  extract_crowdmark: 'Crowdmark',
  extract_generic: 'Other pastes',
  extract_grades: 'Grades',
  summarize_diff: 'Page change summaries',
  cleanup: 'Note cleanup',
  note_meta: 'Note topics and summaries',
  ask: 'Ask',
  ask_deep: 'Ask, deep',
};

function usd(n: number): string {
  return `$${n.toFixed(n < 1 ? 3 : 2)}`;
}

/** Month-to-date Claude spend by purpose, from ai_calls. */
async function AiSpend() {
  const { supabase } = await getAppContext();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { data } = await supabase.from('ai_calls').select('purpose, cost_usd, ok').gte('created_at', monthStart).limit(5000);
  const rows = data ?? [];
  const byPurpose = new Map<string, { calls: number; failed: number; cost: number }>();
  for (const r of rows) {
    const e = byPurpose.get(r.purpose) ?? { calls: 0, failed: 0, cost: 0 };
    e.calls++;
    if (!r.ok) e.failed++;
    e.cost += Number(r.cost_usd ?? 0);
    byPurpose.set(r.purpose, e);
  }
  const total = [...byPurpose.values()].reduce((s, e) => s + e.cost, 0);
  const budget = serverEnv.AI_MONTHLY_BUDGET_USD;
  return (
    <Block title="Spend this month">
      {!serverEnv.ANTHROPIC_API_KEY ? <p className="text-sm text-late">No Anthropic API key is set, so nothing is sent to Claude.</p> : null}
      <p className="text-sm tabular">
        {usd(total)} of the {usd(budget)} monthly budget.{' '}
        {total >= budget ? <span className="font-semibold text-late">Budget reached: pastes are stored without extraction until next month.</span> : null}
      </p>
      {rows.length ? (
        <table className="w-full max-w-lg text-sm tabular">
          <thead>
            <tr className="border-b border-rule text-left text-muted-foreground">
              <th className="py-1 font-normal">Purpose</th>
              <th className="py-1 text-right font-normal">Calls</th>
              <th className="py-1 text-right font-normal">Cost</th>
            </tr>
          </thead>
          <tbody>
            {[...byPurpose.entries()]
              .sort((a, b) => b[1].cost - a[1].cost)
              .map(([purpose, e]) => (
                <tr key={purpose} className="border-b border-rule">
                  <td className="py-1">{PURPOSE_LABEL[purpose] ?? purpose}</td>
                  <td className="py-1 text-right">
                    {e.calls}
                    {e.failed ? ` (${e.failed} failed)` : ''}
                  </td>
                  <td className="py-1 text-right">{usd(e.cost)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-muted-foreground">No Claude calls this month.</p>
      )}
    </Block>
  );
}

const GCAL_RESULT: Record<string, { text: string; bad: boolean }> = {
  connected: { text: 'Google Calendar connected. The first sync is running.', bad: false },
  denied: { text: 'Google access was not granted, so nothing changed.', bad: true },
  expired: { text: 'That sign-in took too long or came from another tab. Connect again.', bad: true },
  error: { text: 'Connecting to Google failed. Try again; if it keeps failing, check the Google client settings (docs/SETUP.md step 7).', bad: true },
  not_configured: { text: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set on the server.', bad: true },
};

type BridgeRun = { started_at: string; stats: unknown };

function lastBridge(runs: BridgeRun[], kind: string): BridgeRun | undefined {
  return runs.find((r) => (r.stats as { kind?: string } | null)?.kind === kind);
}

export default async function SettingsSection({ params, searchParams }: PageProps<'/settings/[section]'>) {
  const { section } = await params;
  const query = await searchParams;
  if (!SETTINGS_SECTIONS.some(([s]) => s === section)) notFound();
  const { supabase, user, term, courses } = await getAppContext();
  const now = new Date();

  switch (section) {
    case 'term': {
      const { count } = await supabase.from('items').select('id', { count: 'exact', head: true });
      return (
        <div className="grid gap-6">
          <Block title="Fall 2026 setup">
            <p className="text-sm text-muted-foreground">
              Loads the four courses with their colors, AI switches, links, watched pages, and outline dates. Running it again only adds
              what is missing; it never overwrites your edits.
            </p>
            <LoadTermButton />
          </Block>
          <Block title="Current term">
            {term ? (
              <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm tabular">
                <dt className="text-muted-foreground">Term</dt>
                <dd>
                  {term.name} ({term.code})
                </dd>
                <dt className="text-muted-foreground">Classes start</dt>
                <dd>{formatListDate(fromTorontoLocal(term.starts_on, '12:00'))}</dd>
                <dt className="text-muted-foreground">Term ends</dt>
                <dd>{formatListDate(fromTorontoLocal(term.ends_on, '12:00'))}</dd>
                <dt className="text-muted-foreground">Courses</dt>
                <dd>{courses.length}</dd>
                <dt className="text-muted-foreground">Items</dt>
                <dd>{count ?? 0}</dd>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">No term loaded yet. {TERM_F26.name} runs {TERM_F26.startsOn} to {TERM_F26.endsOn}.</p>
            )}
          </Block>
        </div>
      );
    }

    case 'courses': {
      const [{ data: settings }, { data: emails }] = await Promise.all([
        supabase.from('settings').select('piazza_map').maybeSingle(),
        supabase.from('documents').select('course_id, class_id:meta->>class_id').eq('kind', 'piazza_email').limit(5000),
      ]);
      const piazzaMap = Object.fromEntries(
        Object.entries((settings?.piazza_map ?? {}) as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'),
      );
      const nids = [...new Set([...TERM_F26.piazzaClasses.map((c) => c.nid), ...(emails ?? []).map((e) => e.class_id).filter((n): n is string => !!n)])];
      const piazzaClasses: PiazzaClassRow[] = nids.map((nid) => {
        const mine = (emails ?? []).filter((e) => e.class_id === nid);
        return { nid, url: `https://piazza.com/class/${nid}`, emails: mine.length, waiting: mine.filter((e) => !e.course_id).length };
      });
      return (
        <div className="grid gap-6">
          {courses.length ? null : <p className="text-sm text-muted-foreground">Load the Fall 2026 setup in Term first.</p>}
          {courses.map((c) => (
            <Block key={c.id} title={c.code}>
              <p className="flex items-center gap-2 text-sm">
                <CourseDot course={c} /> {c.title}, colors {c.color} and {c.color_dark}
              </p>
              <p className="text-sm">
                <span className="font-semibold">AI switch: {c.ai_allowed ? 'on' : 'off'}.</span>{' '}
                {c.ai_allowed
                  ? `${c.code}'s pastes and notes can be sent to Claude.`
                  : `Nothing from ${c.code} is sent to Claude.`}
              </p>
              <p className="text-sm text-muted-foreground">Outline AI policy: {c.ai_policy ?? 'not recorded'}</p>
              <AiSwitch courseId={c.id} code={c.code} on={c.ai_allowed} policy={c.ai_policy} />
            </Block>
          ))}
          {courses.length ? (
            <Block title="Piazza classes">
              <p className="max-w-prose text-sm text-muted-foreground">
                Piazza emails find their course through the class link inside them. Open each class to see which course it is, then pick it
                here. Emails from a class with no course are stored and wait; nothing from them is read until you pick one.
              </p>
              <PiazzaMapForm classes={piazzaClasses} courses={courses.map((c) => ({ slug: c.slug, code: c.code }))} map={piazzaMap} />
            </Block>
          ) : null}
        </div>
      );
    }

    case 'integrations': {
      const [learn, google, feed, odyssey, mcp, { data: bridgeRuns }, { data: newestEmail }] = await Promise.all([
        learnFeedStatus(createAdminClient(), user.id),
        googleStatus(user.id),
        feedStatus(createAdminClient(), user.id),
        odysseyScriptStatus(createAdminClient(), user.id),
        mcpStatus(createAdminClient(), user.id),
        supabase.from('sync_runs').select('started_at, stats').eq('source', 'bridge').order('started_at', { ascending: false }).limit(200),
        supabase
          .from('documents')
          .select('id, title, captured_at, course_id')
          .eq('kind', 'piazza_email')
          .order('captured_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      const result = typeof query.gcal === 'string' ? GCAL_RESULT[query.gcal] : undefined;
      const ping = lastBridge(bridgeRuns ?? [], 'ping');
      const digest = lastBridge(bridgeRuns ?? [], 'digest');
      const email = lastBridge(bridgeRuns ?? [], 'email');
      const g = google.meta;
      return (
        <div className="grid gap-6">
          <Block title="Google Calendar">
            {result ? (
              <p role="status" className={cn('text-sm', result.bad ? 'text-late' : 'font-semibold')}>
                {result.text}
              </p>
            ) : null}
            {!google.configured ? (
              <p className="text-sm text-muted-foreground">
                Waiting for the Google client ID and secret (docs/SETUP.md step 7). Deadlines reach Google Calendar once they are set.
              </p>
            ) : !google.connected ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Not connected. Connecting creates a calendar named Runway in your Google account; Runway can only touch that calendar.
                </p>
                <div>
                  <a href="/api/gcal/connect" className={cn(buttonVariants(), 'h-11 sm:h-9')}>
                    Connect Google Calendar
                  </a>
                </div>
              </>
            ) : (
              <>
                {google.status === 'reauth_required' ? (
                  <p role="alert" className="text-sm font-semibold text-late">
                    Google access stopped working, so the calendar is not updating. Reconnect to fix it.
                  </p>
                ) : null}
                <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm tabular">
                  <dt className="text-muted-foreground">Calendar</dt>
                  <dd>{g.calendar_name ?? 'Runway'}</dd>
                  <dt className="text-muted-foreground">Connected</dt>
                  <dd>{g.connected_at ? formatAgo(new Date(g.connected_at), now) : 'yes'}</dd>
                  <dt className="text-muted-foreground">Last sync</dt>
                  <dd>
                    {g.last_sync_at
                      ? `${formatAgo(new Date(g.last_sync_at), now)}, ${g.last_sync_writes ?? 0} ${g.last_sync_writes === 1 ? 'change' : 'changes'} written`
                      : 'Not yet'}
                  </dd>
                </dl>
                {g.last_error && google.status !== 'reauth_required' ? <p className="text-sm text-late">{g.last_error}</p> : null}
                <div className="flex flex-wrap gap-2">
                  {google.status === 'reauth_required' ? (
                    <a href="/api/gcal/connect" className={cn(buttonVariants(), 'h-11 sm:h-8')}>
                      Reconnect Google Calendar
                    </a>
                  ) : (
                    <RunNowButton target={{ kind: 'calendar' }} label="Sync calendar now" />
                  )}
                  <DisconnectGoogleButton />
                </div>
              </>
            )}
          </Block>
          <Block title="Install on this device">
            <p className="text-sm text-muted-foreground">
              Runway opens from the home screen like an app. Today and Calendar keep their last copy, so they still open with no
              signal.
            </p>
            <InstallApp />
          </Block>
          <Block title="Apple Calendar feed">
            <p className="text-sm text-muted-foreground">
              A read-only calendar link with the same events as the Google calendar: deadlines, exams, prep days, study blocks, and paste
              reminders. Calendar apps check it about once an hour.
            </p>
            {feed.on ? (
              <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm tabular">
                <dt className="text-muted-foreground">Made</dt>
                <dd>{feed.createdAt ? formatAgo(new Date(feed.createdAt), now) : 'yes'}</dd>
                <dt className="text-muted-foreground">Last read</dt>
                <dd>{feed.lastFetchedAt ? formatAgo(new Date(feed.lastFetchedAt), now) : 'Not yet'}</dd>
              </dl>
            ) : null}
            {serverEnv.TOKEN_ENCRYPTION_KEY ? (
              <FeedControls url={feed.url} webcal={feed.url ? webcalUrl(feed.url) : null} />
            ) : (
              <p className="text-sm text-muted-foreground">Waiting for TOKEN_ENCRYPTION_KEY, which stores the link.</p>
            )}
          </Block>
          <Block title="Odyssey userscript">
            <p className="text-sm text-muted-foreground">
              Sends exam rows (date, time, room, seat) from Odyssey to your Inbox whenever you open your exam schedule there. It runs in your
              own signed-in browser; Runway never signs in to Odyssey.
            </p>
            <ol className="ml-5 list-decimal text-sm">
              <li>Install Tampermonkey (or another userscript manager) in the browser you use for Odyssey.</li>
              <li>Download the userscript and open it with Tampermonkey (Dashboard, Utilities, Import from file), or make a new script and paste it.</li>
              <li>
                Open{' '}
                <a href={ODYSSEY_PAGE} target="_blank" rel="noreferrer" className="text-link underline-offset-2 hover:underline">
                  your Odyssey exam schedule
                </a>
                . A box in the corner says what was sent. New rooms and seats show up in the Inbox to approve.
              </li>
            </ol>
            {odyssey.on ? (
              <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm tabular">
                <dt className="text-muted-foreground">Turned on</dt>
                <dd>{odyssey.createdAt ? formatAgo(new Date(odyssey.createdAt), now) : 'yes'}</dd>
                <dt className="text-muted-foreground">Last sent</dt>
                <dd>
                  {odyssey.lastSentAt ? (
                    <>
                      {formatAgo(new Date(odyssey.lastSentAt), now)}, {odyssey.lastRows ?? 0} {odyssey.lastRows === 1 ? 'row' : 'rows'}
                      {odyssey.lastDocumentId ? (
                        <>
                          {' '}
                          (
                          <Link href={`/library/${odyssey.lastDocumentId}`} className="text-link underline-offset-2 hover:underline">
                            see them
                          </Link>
                          )
                        </>
                      ) : null}
                    </>
                  ) : (
                    'Not yet'
                  )}
                </dd>
              </dl>
            ) : null}
            {serverEnv.TOKEN_ENCRYPTION_KEY ? (
              <OdysseyControls appUrl={serverEnv.APP_URL} token={odyssey.token} />
            ) : (
              <p className="text-sm text-muted-foreground">Waiting for TOKEN_ENCRYPTION_KEY, which stores the token.</p>
            )}
          </Block>
          <Block title="Claude connector (MCP)">
            <p className="text-sm text-muted-foreground">
              Lets a Claude chat read Runway: what&apos;s due, rooms and weights, and search. It can read notes only from courses with AI
              on. It can&apos;t change anything.
            </p>
            <ol className="ml-5 list-decimal text-sm">
              <li>Make the connector link below and copy it.</li>
              <li>
                In Claude, open Settings, Connectors, Add custom connector. Name it Runway and paste the link. In Claude Code, run{' '}
                <code className="font-mono text-xs">claude mcp add --transport http runway &lt;link&gt;</code>.
              </li>
              <li>Ask things like &quot;What&apos;s due this week?&quot; or &quot;Where is my STAT 230 midterm?&quot;</li>
            </ol>
            {mcp.on ? (
              <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm tabular">
                <dt className="text-muted-foreground">Made</dt>
                <dd>{mcp.createdAt ? formatAgo(new Date(mcp.createdAt), now) : 'yes'}</dd>
                <dt className="text-muted-foreground">Last used</dt>
                <dd>{mcp.lastUsedAt ? formatAgo(new Date(mcp.lastUsedAt), now) : 'Not yet'}</dd>
              </dl>
            ) : null}
            {serverEnv.TOKEN_ENCRYPTION_KEY ? (
              <McpControls url={mcp.url} />
            ) : (
              <p className="text-sm text-muted-foreground">Waiting for TOKEN_ENCRYPTION_KEY, which stores the link.</p>
            )}
          </Block>
          <Block title="LEARN feed">
            <p className="text-sm">
              {learn.saved
                ? `Saved ${learn.savedAt ? formatAgo(new Date(learn.savedAt), now) : ''} (${learn.host ?? 'unknown host'}). ${
                    learn.status === 'error' ? 'The last sync failed; see Sync.' : 'Syncs every hour.'
                  }`
                : 'No feed URL saved. STAT 230 and CS 245 deadlines from LEARN arrive once you add it.'}
            </p>
            <LearnFeedForm saved={learn.saved} />
          </Block>
          <Block title="UW Open Data">
            <p className="text-sm text-muted-foreground">
              {serverEnv.UW_OPENDATA_API_KEY
                ? 'Key saved. Final exams and important dates sync every morning.'
                : 'No key saved yet. Final exams and important dates sync once UW_OPENDATA_API_KEY is set (docs/SETUP.md step 4).'}
            </p>
          </Block>
          <Block title="Apps Script bridge">
            <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm tabular">
              <dt className="text-muted-foreground">Last ping</dt>
              <dd>{ping ? formatAgo(new Date(ping.started_at), now) : 'None yet'}</dd>
              <dt className="text-muted-foreground">Last digest</dt>
              <dd>{digest ? formatAgo(new Date(digest.started_at), now) : 'None yet'}</dd>
              <dt className="text-muted-foreground">Last email check</dt>
              <dd>
                {email
                  ? `${formatAgo(new Date(email.started_at), now)}, ${Number((email.stats as { stored?: number }).stored ?? 0)} new`
                  : 'None yet'}
              </dd>
              <dt className="text-muted-foreground">Last email</dt>
              <dd>
                {newestEmail ? (
                  <>
                    <Link href={`/library/${newestEmail.id}`} className="text-link underline-offset-2 hover:underline">
                      {newestEmail.title}
                    </Link>
                    , sent {formatAgo(new Date(newestEmail.captured_at), now)}
                    {newestEmail.course_id ? null : ' (no course yet)'}
                  </>
                ) : (
                  'None yet'
                )}
              </dd>
            </dl>
            {ping ? null : (
              <p className="text-sm text-muted-foreground">
                Install the bridge from docs/SETUP.md step 8 and run its setup function; the ping shows here.
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              Piazza emails are stored as they arrive and filed by class. Pick the course for each class in{' '}
              <Link href="/settings/courses" className="text-link underline-offset-2 hover:underline">
                Courses
              </Link>
              .
            </p>
          </Block>
        </div>
      );
    }

    case 'reminders': {
      const { data: settings } = await supabase.from('settings').select('study_block_hour, reminder_rules').maybeSingle();
      const overrides = parseOverrides(settings?.reminder_rules);
      const NOTES: Partial<Record<string, string>> = {
        assignment: 'CS 246 keeps 10 runway days unless you change this.',
        midterm: '3 study blocks in the week before',
        final: 'Study blocks every other day',
      };
      const rows = ITEM_KINDS.map((k) => {
        const rule = resolveRule(k, null, overrides);
        return { kind: k, label: KIND_LABEL[k], prepDays: rule.prepDays, reminders: rule.reminders, note: NOTES[k] };
      });
      return (
        <div className="grid gap-6">
          <Block title="Reminder rules">
            <p className="text-sm text-muted-foreground">
              Runway days put a prep block on your calendar that many days before the due date. Reminders count back from the due or start
              time (date-only items count back from 9:00 on the day). Google allows 5 reminders per event, up to 4 weeks before.
            </p>
            <ReminderRulesForm rows={rows} studyBlockHour={settings?.study_block_hour ?? 19} />
          </Block>
          <Block title="Digest and weekly sweep">
            <p className="text-sm text-muted-foreground">
              The Apps Script bridge emails the digest between 8 and 9 am (its trigger is set in Code.gs). The weekly sweep reminder comes
              on Sundays at 6:00 pm.
            </p>
          </Block>
        </div>
      );
    }

    case 'ai': {
      const [{ data: aiSettings }, embeddings] = await Promise.all([
        supabase.from('settings').select('note_style_prompt, answer_style_prompt, ask_context_budget').maybeSingle(),
        embeddingStatus(supabase, user.id),
      ]);
      return (
        <div className="grid gap-6">
          <Block title="Notes">
            <NoteStyleForm style={aiSettings?.note_style_prompt ?? null} fallback={DEFAULT_NOTE_STYLE} />
          </Block>
          <Block title="Ask">
            <AskSettingsForm
              style={aiSettings?.answer_style_prompt ?? null}
              budget={aiSettings?.ask_context_budget ?? DEFAULT_CONTEXT_BUDGET}
              fallback={DEFAULT_ANSWER_STYLE}
            />
          </Block>
          <Block title="Hybrid search">
            <p className="max-w-2xl text-sm text-muted-foreground">
              Ask finds passages by their words. Hybrid search also finds passages that say the same thing in other words, using
              embeddings from Voyage AI ({EMBED_MODEL}). Only passages from courses with AI on are sent.
            </p>
            <HybridSearchControls {...embeddings} />
          </Block>
          <Block title="Models">
            <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
              <dt className="text-muted-foreground">Extraction</dt>
              <dd>{serverEnv.MODEL_EXTRACT}</dd>
              <dt className="text-muted-foreground">Note cleanup</dt>
              <dd>{serverEnv.MODEL_CLEANUP}</dd>
              <dt className="text-muted-foreground">Ask</dt>
              <dd>{serverEnv.MODEL_ASK}</dd>
              <dt className="text-muted-foreground">Ask, deep</dt>
              <dd>{serverEnv.MODEL_ASK_DEEP}</dd>
            </dl>
          </Block>
          <AiSpend />
        </div>
      );
    }

    case 'sync': {
      const [{ data: pages }, { data: runs }, learn] = await Promise.all([
        supabase.from('watched_pages').select('id, label, url, parser, cadence, course_id').order('label'),
        supabase
          .from('sync_runs')
          .select('source, ok, started_at, finished_at, error, stats')
          .order('started_at', { ascending: false })
          .limit(300),
        learnFeedStatus(createAdminClient(), user.id),
      ]);
      const bySource = new Map<string, RunRow[]>();
      for (const r of runs ?? []) bySource.set(r.source, [...(bySource.get(r.source) ?? []), r]);
      const courseCode = new Map(courses.map((c) => [c.id, c.code]));
      const rows: SyncRowProps[] = [
        {
          name: 'LEARN calendar feed',
          detail: 'STAT 230 and CS 245, hourly',
          runs: bySource.get('learn_ics') ?? [],
          target: learn.saved ? { kind: 'learn_ics' } : null,
          idle: learn.saved ? null : 'No feed URL saved. Add it in Integrations.',
        },
        {
          name: 'UW Open Data',
          detail: 'Final exams and important dates, daily',
          runs: bySource.get('open_data') ?? [],
          target: serverEnv.UW_OPENDATA_API_KEY ? { kind: 'open_data' } : null,
          idle: serverEnv.UW_OPENDATA_API_KEY ? null : 'Waiting for the UW Open Data key (docs/SETUP.md step 4).',
        },
        {
          name: 'Google Calendar',
          detail: 'Deadlines, prep blocks, and paste reminders on the Runway calendar',
          runs: bySource.get('gcal') ?? [],
          target: { kind: 'calendar' },
          idle: bySource.get('gcal')?.length ? null : 'Connect Google Calendar in Integrations. Run now refreshes the paste reminders either way.',
        },
        ...(pages ?? []).map((p) => ({
          name: `${p.course_id ? `${courseCode.get(p.course_id) ?? ''} ` : ''}${p.label}`,
          detail: `${p.parser === 'diff' ? 'Watched for changes' : 'Read for dates'}, ${CADENCE_LABEL[p.cadence] ?? p.cadence}`,
          url: p.url,
          runs: bySource.get(pageRunSource(p)) ?? [],
          target: { kind: 'page' as const, pageId: p.id },
          idle: null,
        })),
      ];
      return (
        <div className="grid gap-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">Supabase Cron runs these on schedule. Run one now to check it.</p>
            {pages?.length ? <RunNowButton target={{ kind: 'all' }} label="Run all now" /> : null}
          </div>
          {pages?.length ? null : (
            <p className="text-sm text-muted-foreground">No watched pages. Load the Fall 2026 setup to add the CS 246 and CS 251 pages.</p>
          )}
          <ul className="divide-y divide-rule border-y border-rule">
            {rows.map((r) => (
              <SyncRow key={r.name + (r.url ?? '')} {...r} now={now} />
            ))}
          </ul>
        </div>
      );
    }

    case 'data': {
      const [{ data: terms }, { data: termCourses }] = await Promise.all([
        supabase.from('terms').select('id, name, starts_on, ends_on').order('starts_on', { ascending: false }),
        supabase.from('courses').select('id, term_id'),
      ]);
      const [itemCounts, termWideCounts] = await Promise.all([
        Promise.all((termCourses ?? []).map((c) => supabase.from('items').select('id', { count: 'exact', head: true }).eq('course_id', c.id))),
        Promise.all(
          (terms ?? []).map((t) =>
            supabase.from('items').select('id', { count: 'exact', head: true }).is('course_id', null).or(termDatedFilter(t)),
          ),
        ),
      ]);
      const counts = new Map<string, { courses: number; items: number }>(
        (terms ?? []).map((t, i) => [t.id, { courses: 0, items: termWideCounts[i].count ?? 0 }]),
      );
      (termCourses ?? []).forEach((c, i) => {
        const e = counts.get(c.term_id);
        if (!e) return;
        e.courses++;
        e.items += itemCounts[i].count ?? 0;
      });
      return (
        <div className="grid gap-6">
          <Block title="Export">
            <p className="max-w-prose text-sm text-muted-foreground">
              Downloads one zip: every deadline, course, link, paste, note, grade, reminder, Ask thread, and change log as JSON, each
              lecture note as a Markdown file, and any stored files. Connection tokens are left out.
            </p>
            <div>
              <a href="/api/export" download className={cn(buttonVariants(), 'h-11 sm:h-9')}>
                Download export
              </a>
            </div>
          </Block>
          <Block title="Delete a term">
            {terms?.length ? (
              <ul className="grid gap-4">
                {terms.map((t) => {
                  const c = counts.get(t.id) ?? { courses: 0, items: 0 };
                  return (
                    <li key={t.id} className="grid gap-2">
                      <p className="text-sm tabular">
                        <span className="font-semibold">{t.name}</span>: {c.courses} {c.courses === 1 ? 'course' : 'courses'}, {c.items}{' '}
                        {c.items === 1 ? 'item' : 'items'}
                      </p>
                      <DeleteTermButton termId={t.id} name={t.name} courses={c.courses} items={c.items} />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No terms stored.</p>
            )}
          </Block>
        </div>
      );
    }
  }
  notFound();
}
