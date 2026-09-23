import { notFound } from 'next/navigation';
import { AskThreads } from '@/components/app/ask-threads';
import { AskView, type AskMessageView } from '@/components/app/ask-view';
import type { SavedCitation } from '@/lib/ask/citations';
import { readScope } from '@/lib/ask/scope';
import { getAppContext } from '@/lib/db/queries';
import { askPageData } from '../data';

export async function generateMetadata({ params }: PageProps<'/ask/[threadId]'>) {
  const { threadId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(threadId)) return { title: 'Ask' };
  const { supabase } = await getAppContext();
  const { data } = await supabase.from('ask_threads').select('title').eq('id', threadId).maybeSingle();
  return { title: data?.title ?? 'Ask' };
}

export default async function AskThreadPage({ params }: PageProps<'/ask/[threadId]'>) {
  const { threadId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(threadId)) notFound();
  const { supabase, user } = await getAppContext();
  const [{ data: thread }, { data: rows }, data] = await Promise.all([
    supabase.from('ask_threads').select('id, title, scope').eq('id', threadId).maybeSingle(),
    supabase.from('ask_messages').select('id, role, content, citations, model').eq('thread_id', threadId).order('created_at'),
    askPageData(supabase, user.id),
  ]);
  if (!thread) notFound();
  const messages: AskMessageView[] = (rows ?? []).map((m) => ({
    id: m.id,
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
    citations: (Array.isArray(m.citations) ? m.citations : []) as unknown as SavedCitation[],
    model: m.model,
  }));

  return (
    <div className="grid max-w-5xl gap-6">
      <h2 className="text-2xl font-semibold">{thread.title ?? 'Ask'}</h2>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_260px]">
        <AskView
          key={thread.id}
          threadId={thread.id}
          initialScope={readScope(thread.scope)}
          options={data.options}
          messages={messages}
          aiReady={data.aiReady}
          overBudget={data.overBudget}
        />
        <section aria-labelledby="threads-heading" className="grid content-start gap-2">
          <h3 id="threads-heading" className="text-base font-semibold">
            Past questions
          </h3>
          <AskThreads threads={data.threads} options={data.options} activeId={thread.id} now={new Date()} />
        </section>
      </div>
    </div>
  );
}
