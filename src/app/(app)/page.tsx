import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/app/empty-state';
import { ItemRow, type RowItem } from '@/components/app/item-row';
import { QuickActions } from '@/components/app/quick-actions';
import { countNeedsYou, getAppContext } from '@/lib/db/queries';
import { describeChange } from '@/lib/items/changes';
import { EXAM_KINDS, ROW_FIELDS } from '@/lib/items/labels';
import { effectiveDue, isDone } from '@/lib/items/runway';
import { formatAgo, formatCountdown, formatHeadingDate, formatListDate, termWeek, toTorontoDate } from '@/lib/time';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Today' };

const DAY = 86_400_000;
const OVERDUE_KINDS = new Set(['assignment', 'quiz', 'project', 'reading', 'other']);

function firstSentence(text: string): string {
  const match = /^.*?[.!?](\s|$)/.exec(text);
  return (match ? match[0] : text).trim();
}

export default async function TodayPage() {
  const { supabase, term, courses } = await getAppContext();
  const now = new Date();

  if (!term) {
    return (
      <div className="grid gap-6">
        <h2 className="text-2xl font-semibold">{formatHeadingDate(now)}</h2>
        <EmptyState
          title="No term loaded yet"
          action={
            <Link href="/settings/term" className={cn(buttonVariants(), 'h-11 sm:h-9')}>
              Open Settings, Term
            </Link>
          }
        >
          Load the Fall 2026 setup to bring in your four courses, their links, and the outline dates.
        </EmptyState>
      </div>
    );
  }

  const from = new Date(now.getTime() - 8 * DAY).toISOString();
  const to = new Date(now.getTime() + 15 * DAY).toISOString();
  const [itemsRes, examRes, changesRes, needs] = await Promise.all([
    supabase
      .from('items')
      .select(ROW_FIELDS)
      .eq('state', 'active')
      .or(`and(due_at.gte.${from},due_at.lte.${to}),and(due_at.is.null,starts_at.gte.${from},starts_at.lte.${to})`)
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(300),
    supabase
      .from('items')
      .select('id, course_id, kind, title, due_at, starts_at, time_known')
      .eq('state', 'active')
      .in('kind', EXAM_KINDS)
      .gte('due_at', now.toISOString())
      .order('due_at')
      .limit(1),
    supabase
      .from('item_changes')
      .select('id, field, old_value, new_value, source, detected_at, items(id, title, course_id)')
      .gte('detected_at', new Date(now.getTime() - 3 * DAY).toISOString())
      .neq('source', 'manual')
      .order('detected_at', { ascending: false })
      .limit(20),
    countNeedsYou(),
  ]);

  const courseById = new Map(courses.map((c) => [c.id, c]));
  const items = (itemsRes.data ?? []) as RowItem[];
  const withDue = items.map((item) => ({ item, due: effectiveDue(item)! })).filter((x) => x.due);

  const upcoming = withDue.filter(({ item, due }) => due > now && due.getTime() <= now.getTime() + 14 * DAY && item.kind !== 'break');
  const overdue = withDue.filter(
    ({ item, due }) => due <= now && due.getTime() >= now.getTime() - 7 * DAY && OVERDUE_KINDS.has(item.kind) && !isDone(item.progress),
  );

  const byDay = new Map<string, RowItem[]>();
  for (const { item } of upcoming) {
    const key = toTorontoDate(new Date(item.due_at ?? item.starts_at!));
    byDay.set(key, [...(byDay.get(key) ?? []), item]);
  }

  const week = termWeek(term.starts_on, term.ends_on, now);
  const exam = examRes.data?.[0];
  const examCourse = exam?.course_id ? courseById.get(exam.course_id) : null;
  const needsTotal = needs.proposals + needs.pastes + needs.failing.length;

  return (
    <div className="grid gap-8">
      <header className="grid gap-1">
        <h2 className="text-2xl font-semibold">{formatHeadingDate(now)}</h2>
        <p className="text-muted-foreground">
          {week ? `Week ${week}` : term.name}
          {exam ? (
            <>
              .{' '}
              <span className="text-foreground">
                {examCourse ? `${examCourse.code} ` : ''}
                {exam.title}{' '}
              </span>
              <span className="text-foreground tabular">{formatCountdown(new Date(exam.due_at!), exam.time_known, now)}</span>
            </>
          ) : null}
        </p>
      </header>

      {needsTotal > 0 ? (
        <section aria-label="Needs you" className="flex flex-wrap items-center gap-x-4 gap-y-1 border-y border-rule py-3 text-sm">
          <span className="font-semibold">Needs you:</span>
          {needs.proposals ? (
            <Link href="/inbox" className="text-tie underline-offset-2 hover:underline">
              {needs.proposals} {needs.proposals === 1 ? 'change' : 'changes'} to review
            </Link>
          ) : null}
          {needs.pastes ? (
            <Link href="/inbox#paste-reminders" className="text-tie underline-offset-2 hover:underline">
              {needs.pastes} {needs.pastes === 1 ? 'paste' : 'pastes'} due
            </Link>
          ) : null}
          {needs.failing.length ? (
            <Link href="/settings/sync" className="text-late underline-offset-2 hover:underline">
              {needs.failing.length} {needs.failing.length === 1 ? 'source' : 'sources'} failing
            </Link>
          ) : null}
        </section>
      ) : null}

      {needs.failing.length ? (
        <section role="alert" className="grid gap-1 rounded-md border border-late p-3 text-sm">
          <p className="font-semibold text-late">
            {needs.failing.join(', ')} {needs.failing.length === 1 ? 'has' : 'have'} failed three times in a row.
          </p>
          <p>
            Dates from {needs.failing.length === 1 ? 'it' : 'them'} may be out of date.{' '}
            <Link href="/settings/sync" className="text-tie underline-offset-2 hover:underline">
              See the errors in Settings, Sync
            </Link>
          </p>
        </section>
      ) : null}

      <QuickActions />

      {overdue.length ? (
        <section className="grid gap-2" aria-labelledby="overdue">
          <h3 id="overdue" className="text-[21px] font-semibold text-late">
            Overdue
          </h3>
          <ul>
            {overdue.map(({ item }) => {
              const course = item.course_id ? courseById.get(item.course_id) : null;
              return (
                <ItemRow
                  key={item.id}
                  item={item}
                  now={now}
                  showDate
                  note={course?.late_policy ? `${course.code}: ${firstSentence(course.late_policy)}` : null}
                />
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="grid gap-4" aria-labelledby="next-14">
        <h3 id="next-14" className="sr-only">
          Next 14 days
        </h3>
        {byDay.size ? (
          [...byDay.entries()].map(([day, dayItems]) => (
            <div key={day} className="grid gap-1">
              <h4 className="text-base font-semibold tabular">{formatHeadingDate(new Date(`${day}T12:00:00Z`))}</h4>
              <ul>
                {dayItems.map((item) => (
                  <ItemRow key={item.id} item={item} now={now} />
                ))}
              </ul>
            </div>
          ))
        ) : (
          <EmptyState title="Nothing due in the next 14 days.">Add anything missing with Add item, or paste an announcement.</EmptyState>
        )}
      </section>

      <section className="grid gap-2" aria-labelledby="changed">
        <h3 id="changed" className="text-[21px] font-semibold">
          Changed recently
        </h3>
        {changesRes.data?.length ? (
          <ul className="divide-y divide-rule text-sm">
            {changesRes.data.map((c) => {
              const it = c.items as unknown as { id: string; title: string; course_id: string | null } | null;
              const course = it?.course_id ? courseById.get(it.course_id) : null;
              const name = `${course ? `${course.code} ` : ''}${it?.title ?? 'An item'}`;
              return (
                <li key={c.id} className="py-2">
                  {describeChange(name, c)}.{' '}
                  <span className="text-muted-foreground">{formatAgo(new Date(c.detected_at), now)}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No changes from your sources in the last 3 days.</p>
        )}
      </section>

      <p className="text-xs text-muted-foreground">Dates shown in Toronto time. Last loaded {formatListDate(now)}.</p>
    </div>
  );
}
