import { EmptyState } from '@/components/app/empty-state';
import { getAppContext } from '@/lib/db/queries';

export const metadata = { title: 'Ask' };

export default async function AskPage() {
  const { courses } = await getAppContext();
  const on = courses.filter((c) => c.ai_allowed).map((c) => c.code);
  return (
    <div className="grid gap-6">
      <h2 className="text-2xl font-semibold">Ask</h2>
      <EmptyState title="Ask is not built yet.">
        It will answer questions from your notes for courses with AI on{on.length ? ` (${on.join(', ')})` : ''}, with citations back to the
        passage it used.
      </EmptyState>
    </div>
  );
}
