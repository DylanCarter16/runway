import { notFound } from 'next/navigation';
import { CourseDot } from '@/components/app/course-mark';
import { LoadTermButton } from '@/components/app/settings-bits';
import { TERM_F26 } from '@/config/term-f26';
import { serverEnv } from '@/env';
import { getAppContext } from '@/lib/db/queries';
import { ITEM_KINDS, KIND_LABEL, sourceLabel } from '@/lib/items/labels';
import { DEFAULT_RULES } from '@/lib/reminders/rules';
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

export default async function SettingsSection({ params }: PageProps<'/settings/[section]'>) {
  const { section } = await params;
  if (!SETTINGS_SECTIONS.some(([s]) => s === section)) notFound();
  const { supabase, term, courses } = await getAppContext();
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

    case 'integrations':
      return (
        <div className="grid gap-6">
          <Block title="Google Calendar">
            <p className="text-sm text-muted-foreground">Not connected. Calendar sync is not built yet.</p>
          </Block>
          <Block title="LEARN feed">
            <p className="text-sm text-muted-foreground">No feed URL saved. The field arrives with automatic sources.</p>
          </Block>
          <Block title="UW Open Data">
            <p className="text-sm text-muted-foreground">{serverEnv.UW_OPENDATA_API_KEY ? 'Key saved.' : 'No key saved yet.'}</p>
          </Block>
          <Block title="Apps Script bridge">
            <p className="text-sm text-muted-foreground">No ping received yet.</p>
          </Block>
        </div>
      );

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
      const [{ data: pages }, { data: runs }] = await Promise.all([
        supabase.from('watched_pages').select('id, label, url, cadence, last_checked_at, last_error').order('label'),
        supabase.from('sync_runs').select('source, ok, finished_at, error').order('started_at', { ascending: false }).limit(50),
      ]);
      return (
        <div className="grid gap-6">
          <Block title="Watched pages">
            {pages?.length ? (
              <ul className="divide-y divide-rule text-sm">
                {pages.map((p) => (
                  <li key={p.id} className="py-2">
                    <a href={p.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-tie underline-offset-2 hover:underline">
                      {p.label}
                    </a>
                    <span className="block text-muted-foreground">
                      Checked {p.cadence.replace('_', ' ')}, {p.last_checked_at ? `last ${formatAgo(new Date(p.last_checked_at), now)}` : 'not checked yet'}
                    </span>
                    {p.last_error ? <span className="block text-late">{p.last_error}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No watched pages. Load the Fall 2026 setup to add the CS 246 and CS 251 pages.</p>
            )}
          </Block>
          <Block title="Recent runs">
            {runs?.length ? (
              <ul className="divide-y divide-rule text-sm">
                {runs.map((r, i) => (
                  <li key={i} className="py-2">
                    {sourceLabel(r.source)}, {r.ok ? 'ok' : 'failed'}
                    {r.finished_at ? `, ${formatAgo(new Date(r.finished_at), now)}` : ''}
                    {r.error ? <span className="block text-late">{r.error}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No syncs have run yet. Automatic sources are the next build step.</p>
            )}
          </Block>
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
