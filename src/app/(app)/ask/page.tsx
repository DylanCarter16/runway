import { AskThreads } from '@/components/app/ask-threads';
import { AskView } from '@/components/app/ask-view';
import { ALL_SCOPE, type AskScope, type ScopeOptions } from '@/lib/ask/scope';
import { getAppContext } from '@/lib/db/queries';
import { askPageData } from './data';

export const metadata = { title: 'Ask' };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Entry points link here with ?note=, ?item=, or ?course= and an optional ?q= question. */
function startScope(sp: Record<string, string | string[] | undefined>, options: ScopeOptions): AskScope {
  const note = one(sp.note);
  if (note && options.notes.some((n) => n.id === note)) return { type: 'note', noteId: note };
  const item = one(sp.item);
  if (item && options.items.some((i) => i.id === item)) return { type: 'item', itemId: item };
  const course = one(sp.course);
  const match = course ? options.courses.find((c) => c.id === course || c.slug === course) : undefined;
  if (match) return { type: 'course', courseId: match.id };
  return ALL_SCOPE;
}

export default async function AskPage({ searchParams }: PageProps<'/ask'>) {
  const sp = await searchParams;
  const { supabase, user } = await getAppContext();
  const data = await askPageData(supabase, user.id);
  const asked = [one(sp.note), one(sp.item)].find(Boolean);
  const scope = startScope(sp, data.options);
  const offScope = Boolean(asked) && scope.type === 'all';

  return (
    <div className="grid max-w-5xl gap-6">
      <h2 className="text-2xl font-semibold">Ask</h2>
      {offScope ? (
        <p role="status" className="border-l-4 border-soon bg-sheet p-3 text-sm">
          That note or item belongs to a course with AI off, so Ask can&apos;t use it.
        </p>
      ) : null}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_260px]">
        <AskView
          threadId={null}
          initialScope={scope}
          options={data.options}
          messages={[]}
          initialQuestion={one(sp.q)?.slice(0, 4000)}
          aiReady={data.aiReady}
          overBudget={data.overBudget}
        />
        <section aria-labelledby="threads-heading" className="grid content-start gap-2">
          <h3 id="threads-heading" className="text-base font-semibold">
            Past questions
          </h3>
          <AskThreads threads={data.threads} options={data.options} now={new Date()} />
        </section>
      </div>
    </div>
  );
}
