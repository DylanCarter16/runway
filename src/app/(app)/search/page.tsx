import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CourseDot } from '@/components/app/course-mark';
import { selectClass } from '@/components/app/item-form';
import { OpenItemButton } from '@/components/app/quick-actions';
import { search, type SearchHit } from '@/app/(app)/actions';
import { getAppContext } from '@/lib/db/queries';
import { fromTorontoLocal, formatListDate } from '@/lib/time';

export const metadata = { title: 'Search' };

const TYPES: [SearchHit['type'], string][] = [
  ['item', 'Items'],
  ['note', 'Notes'],
  ['document', 'Documents'],
  ['link', 'Links'],
];

function str(v: string | string[] | undefined): string {
  return typeof v === 'string' ? v : '';
}

export default async function SearchPage({ searchParams }: PageProps<'/search'>) {
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const type = str(sp.type);
  const courseSlug = str(sp.course);
  const from = str(sp.from);
  const to = str(sp.to);
  const { courses } = await getAppContext();
  const course = courses.find((c) => c.slug === courseSlug) ?? null;
  const courseById = new Map(courses.map((c) => [c.id, c]));

  let hits: SearchHit[] = [];
  let error: string | null = null;
  if (q) {
    const result = await search(q, { limit: 100, courseId: course?.id ?? null });
    if (result.ok) hits = result.data;
    else error = result.error;
  }
  const fromAt = /^\d{4}-\d{2}-\d{2}$/.test(from) ? fromTorontoLocal(from, null) : null;
  const toAt = /^\d{4}-\d{2}-\d{2}$/.test(to) ? fromTorontoLocal(to, '23:59') : null;
  hits = hits.filter((h) => {
    if (type && h.type !== type) return false;
    if ((fromAt || toAt) && !h.at) return false;
    if (fromAt && h.at && new Date(h.at) < fromAt) return false;
    if (toAt && h.at && new Date(h.at) > toAt) return false;
    return true;
  });

  return (
    <div className="grid gap-6">
      <h2 className="text-2xl font-semibold">Search</h2>
      <form className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr] lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] lg:items-end" action="/search">
        <label className="grid gap-1 text-sm">
          <span className="font-semibold">Search for</span>
          <Input name="q" defaultValue={q} className="h-11 sm:h-9" placeholder="251 a1, midterm, odyssey" />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-semibold">Type</span>
          <select name="type" defaultValue={type} className={selectClass}>
            <option value="">Everything</option>
            {TYPES.map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-semibold">Course</span>
          <select name="course" defaultValue={courseSlug} className={selectClass}>
            <option value="">All courses</option>
            {courses.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.code}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-semibold">From</span>
          <Input type="date" name="from" defaultValue={from} className="h-11 sm:h-9" />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-semibold">To</span>
          <Input type="date" name="to" defaultValue={to} className="h-11 sm:h-9" />
        </label>
        <Button type="submit" className="h-11 sm:h-9">
          Search
        </Button>
      </form>

      {error ? <p className="text-sm text-late">{error}</p> : null}
      {q && !hits.length && !error ? <p className="text-sm text-muted-foreground">Nothing matches &quot;{q}&quot;. Try fewer words or another spelling.</p> : null}

      {TYPES.map(([t, label]) => {
        const group = hits.filter((h) => h.type === t);
        if (!group.length) return null;
        return (
          <section key={t} className="grid gap-1">
            <h3 className="text-base font-semibold">
              {label} <span className="font-normal text-muted-foreground tabular">({group.length})</span>
            </h3>
            <ul className="divide-y divide-rule border-y border-rule">
              {group.map((h) => {
                const c = h.courseId ? courseById.get(h.courseId) : null;
                const meta = [c?.code, h.kind, h.type !== 'link' && h.at ? formatListDate(new Date(h.at)) : null].filter(Boolean).join(', ');
                const title = <span className="font-semibold text-tie underline-offset-2 hover:underline">{h.title}</span>;
                return (
                  <li key={`${h.type}-${h.id}`} className="grid gap-0.5 py-2 text-sm">
                    <span className="flex items-center gap-2">
                      <CourseDot course={c} />
                      {h.type === 'item' ? (
                        <OpenItemButton id={h.id} className="min-h-11 sm:min-h-0">
                          {title}
                        </OpenItemButton>
                      ) : h.type === 'link' ? (
                        <a href={h.url ?? '#'} target="_blank" rel="noopener noreferrer" className="min-h-11 content-center sm:min-h-0">
                          {title}
                        </a>
                      ) : (
                        <Link href={h.type === 'note' ? `/notes/${h.id}` : `/library/${h.id}`}>{title}</Link>
                      )}
                    </span>
                    {meta ? <span className="text-muted-foreground tabular">{meta}</span> : null}
                    {h.url ? <span className="truncate text-xs text-muted-foreground">{h.url}</span> : null}
                    {h.snippet ? <span className="text-muted-foreground">{h.snippet.replace(/<\/?b>/g, '')}</span> : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
