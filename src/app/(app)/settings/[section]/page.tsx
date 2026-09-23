import { notFound } from 'next/navigation';
import { CourseDot } from '@/components/app/course-mark';
import { LoadTermButton } from '@/components/app/settings-bits';
import { LearnFeedForm, RunNowButton } from '@/components/app/sync-controls';
import { TERM_F26 } from '@/config/term-f26';
import { serverEnv } from '@/env';
import { createAdminClient } from '@/lib/db/admin';
import { getAppContext } from '@/lib/db/queries';
import { pageRunSource } from '@/lib/jobs/sync';
import { learnFeedStatus } from '@/lib/jobs/tokens';
import type { RunTarget } from '@/lib/jobs/types';
import { ITEM_KINDS, KIND_LABEL } from '@/lib/items/labels';
import { DEFAULT_RULES } from '@/lib/reminders/rules';
import { runSummary, sourceHealth, type RunRow } from '@/lib/sync/summary';
import { SETTINGS_SECTIONS } from '@/lib/ui';
import { formatAgo, formatListDate, fromTorontoLocal } from '@/lib/time';

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

function minutes(m: number): string {
  if (m % 1440 === 0) return `${m / 1440}d`;
  if (m % 60 === 0) return `${m / 60}h`;
  return `${m}m`;
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
            <a href={url} target="_blank" rel="noopener noreferrer" className="text-tie underline-offset-2 hover:underline">
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

export default async function SettingsSection({ params }: PageProps<'/settings/[section]'>) {
  const { section } = await params;
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

    case 'courses':
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
                <span className="text-muted-foreground">{c.ai_policy}</span>
              </p>
            </Block>
          ))}
          <p className="text-sm text-muted-foreground">Changing an AI switch and mapping Piazza classes arrive with the paste inbox.</p>
        </div>
      );

    case 'integrations': {
      const learn = await learnFeedStatus(createAdminClient(), user.id);
      return (
        <div className="grid gap-6">
          <Block title="Google Calendar">
            <p className="text-sm text-muted-foreground">Not connected. Calendar sync is not built yet.</p>
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
            <p className="text-sm text-muted-foreground">No ping received yet.</p>
          </Block>
        </div>
      );
    }

    case 'reminders':
      return (
        <Block title="Default reminder rules">
          <table className="w-full text-sm tabular">
            <thead>
              <tr className="border-b border-rule text-left text-muted-foreground">
                <th className="py-2 pr-3 font-normal">Kind</th>
                <th className="py-2 pr-3 font-normal">Runway</th>
                <th className="py-2 font-normal">Reminders before</th>
              </tr>
            </thead>
            <tbody>
              {ITEM_KINDS.map((k) => (
                <tr key={k} className="border-b border-rule">
                  <td className="py-2 pr-3">{KIND_LABEL[k]}</td>
                  <td className="py-2 pr-3">
                    {DEFAULT_RULES[k].prepDays ? `${DEFAULT_RULES[k].prepDays} days` : 'none'}
                    {k === 'assignment' ? ' (CS 246: 10 days)' : ''}
                  </td>
                  <td className="py-2">{DEFAULT_RULES[k].reminders.map(minutes).join(', ') || 'none'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-sm text-muted-foreground">Editing these arrives with calendar sync.</p>
        </Block>
      );

    case 'ai':
      return (
        <div className="grid gap-6">
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
          <Block title="Spend this month">
            <p className="text-sm text-muted-foreground">No Claude calls yet.</p>
          </Block>
        </div>
      );

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

    case 'data':
      return (
        <Block title="Export">
          <p className="text-sm text-muted-foreground">Export to JSON is not built yet. Everything lives in your Supabase project in the meantime.</p>
        </Block>
      );
  }
  notFound();
}
