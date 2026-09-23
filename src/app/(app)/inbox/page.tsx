import { PasteBox } from '@/components/app/paste-box';
import { ReminderButtons } from '@/components/app/reminder-controls';
import { ReviewQueue } from '@/components/app/review-queue';
import { getAppContext, toLite } from '@/lib/db/queries';
import { PASTE_KINDS } from '@/lib/inbox/kinds';
import { loadReviewGroups } from '@/lib/inbox/queue';
import { formatAgo, formatWhen } from '@/lib/time';
import type { PasteInput } from './actions';

export const metadata = { title: 'Inbox' };

export default async function InboxPage({ searchParams }: PageProps<'/inbox'>) {
  const params = await searchParams;
  const { supabase, courses } = await getAppContext();
  const now = new Date();
  const [{ groups }, { data: reminderRows }] = await Promise.all([
    loadReviewGroups(supabase, courses),
    supabase
      .from('reminders')
      .select('id, title, where_to_find, url, remind_at, snoozed_until')
      .is('done_at', null)
      .lte('remind_at', new Date(now.getTime() + 7 * 86_400_000).toISOString())
      .order('remind_at')
      .limit(50),
  ]);
  const reminders = (reminderRows ?? []).map((r) => {
    const at = new Date(r.snoozed_until && r.snoozed_until > r.remind_at ? r.snoozed_until : r.remind_at);
    return { ...r, at, due: at <= now };
  });
  const due = reminders.filter((r) => r.due);
  const soon = reminders.filter((r) => !r.due);

  const courseParam = typeof params.course === 'string' ? params.course : '';
  const initialCourse = courseParam === 'none' ? 'none' : (courses.find((c) => c.slug === courseParam || c.id === courseParam)?.id ?? '');
  const kindParam = typeof params.kind === 'string' ? params.kind : 'detect';
  const initialKind = (PASTE_KINDS.some((k) => k.value === kindParam) ? kindParam : 'detect') as PasteInput['kind'];

  return (
    <div className="grid max-w-3xl gap-8">
      <h2 className="text-2xl font-semibold">Inbox</h2>
      <PasteBox courses={courses.map(toLite)} initialCourse={initialCourse} initialKind={initialKind} />
      <ReviewQueue groups={groups} courses={courses.map(toLite)} />
      <section id="paste-reminders" className="grid gap-2">
        <h3 className="text-[21px] font-semibold">Paste reminders</h3>
        {due.length ? null : <p className="text-sm text-muted-foreground">No paste reminders due.</p>}
        {[due, soon].map((list, i) =>
          list.length ? (
            <div key={i} className="grid gap-1">
              {i === 1 ? <h4 className="text-sm font-semibold text-muted-foreground">Coming up this week</h4> : null}
              <ul className="divide-y divide-rule border-y border-rule">
                {list.map((r) => (
                  <li key={r.id} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto] sm:items-start sm:gap-4">
                    <div className="grid gap-0.5 text-sm">
                      <span className="font-semibold">{r.title}</span>
                      {r.where_to_find ? <span className="text-muted-foreground">{r.where_to_find}</span> : null}
                      <span className="tabular text-muted-foreground">
                        {r.due ? `Due ${formatAgo(r.at, now)}` : formatWhen(r.at, true)}
                        {r.url ? (
                          <>
                            {' · '}
                            <a
                              href={r.url}
                              target={r.url.startsWith('/') ? undefined : '_blank'}
                              rel="noopener noreferrer"
                              className="text-tie underline-offset-2 hover:underline"
                            >
                              Open {r.url.startsWith('/') ? 'in Runway' : new URL(r.url).host}
                            </a>
                          </>
                        ) : null}
                      </span>
                    </div>
                    {r.due ? <ReminderButtons id={r.id} title={r.title} /> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null,
        )}
      </section>
    </div>
  );
}
