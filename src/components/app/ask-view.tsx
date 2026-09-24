'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SparklesIcon } from 'lucide-react';
import { Markdown } from '@/components/app/markdown';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Toggle } from '@/components/ui/toggle';
import { QUICK_PROMPTS } from '@/lib/ai/prompts';
import type { SavedCitation } from '@/lib/ask/citations';
import { parseScopeKey, scopeBanner, scopeKey, scopeLabel, type AskScope, type ScopeOptions } from '@/lib/ask/scope';
import type { AskStreamEvent } from '@/lib/ask/session';
import { selectClass } from '@/lib/ui';
import { cn } from '@/lib/utils';

// Ask (SPEC 4.6): scope picker, Deep toggle, quick prompts, the AI policy
// banner for graded work, and answers that stream in with citation markers
// and a sources list.

export interface AskMessageView {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: SavedCitation[];
  model: string | null;
}

/** Stored markers say "#source-n"; on the page each answer gets its own anchors. */
function withAnchors(content: string, messageId: string): string {
  return content.replace(/\(#source-(\d+)\)/g, `(#src-${messageId}-$1)`);
}

function Sources({ message }: { message: AskMessageView }) {
  if (!message.citations.length) return null;
  return (
    <section aria-label="Sources" className="grid gap-2 border-t border-rule pt-3">
      <h4 className="text-sm font-semibold">Sources</h4>
      <ol className="grid gap-2">
        {message.citations.map((c) => (
          <li key={c.n} id={`src-${message.id}-${c.n}`} className="grid gap-1 text-sm target:bg-tie/10">
            <p className="flex gap-2">
              <span className="font-semibold text-link">[{c.n}]</span>
              <Link href={c.href} className="font-semibold underline-offset-2 hover:underline">
                {c.title}
              </Link>
            </p>
            <blockquote className="line-clamp-3 border-l-2 border-rule pl-3 text-muted-foreground">{c.cited_text}</blockquote>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function AskView({
  threadId: initialThreadId,
  initialScope,
  options,
  messages: initialMessages,
  initialQuestion,
  aiReady,
  overBudget,
  navigate = true,
  lockCourse,
}: {
  threadId: string | null;
  initialScope: AskScope;
  options: ScopeOptions;
  messages: AskMessageView[];
  initialQuestion?: string;
  aiReady: boolean;
  overBudget: boolean;
  /** Put the new thread's URL in the address bar (the /ask pages). */
  navigate?: boolean;
  /** Course Ask tab: only this course and its notes and items. */
  lockCourse?: string;
}) {
  const router = useRouter();
  const [threadId, setThreadId] = useState(initialThreadId);
  const [messages, setMessages] = useState(initialMessages);
  const [scope, setScope] = useState<AskScope>(initialScope);
  const [question, setQuestion] = useState(initialQuestion ?? '');
  const [deep, setDeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [budgetNotice, setBudgetNotice] = useState(overBudget);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const courses = lockCourse ? options.courses.filter((c) => c.id === lockCourse) : options.courses;
  const notes = options.notes.filter((n) => !lockCourse || n.courseId === lockCourse);
  const items = options.items.filter((i) => !lockCourse || i.courseId === lockCourse);
  const banner = scopeBanner(scope, options);
  const label = scopeLabel(scope, options);
  const code = (id: string) => options.courses.find((c) => c.id === id)?.code ?? '';
  const topic = scope.type === 'note' ? options.notes.find((n) => n.id === scope.noteId)?.title : scope.type === 'item' ? options.items.find((i) => i.id === scope.itemId)?.title : null;
  const canAsk = aiReady && options.courses.length > 0;

  async function ask() {
    const q = question.trim();
    if (!q || busy || !canAsk) return;
    const pendingId = `pending-${Date.now()}`;
    setBusy(true);
    setError(null);
    setStatus(null);
    setQuestion('');
    setMessages((m) => [
      ...m,
      { id: `q-${pendingId}`, role: 'user', content: q, citations: [], model: null },
      { id: pendingId, role: 'assistant', content: '', citations: [], model: null },
    ]);
    const patch = (fn: (m: AskMessageView) => AskMessageView) => setMessages((all) => all.map((m) => (m.id === pendingId ? fn(m) : m)));

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId, scope, question: q, deep }),
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Ask failed (${res.status}). Try again.`);
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      let model: string | null = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const e = JSON.parse(line) as AskStreamEvent;
          if (e.type === 'meta') {
            model = e.model;
            setBudgetNotice(e.budgetNotice);
            if (!threadId) {
              setThreadId(e.threadId);
              if (navigate) window.history.replaceState(null, '', `/ask/${e.threadId}`);
            }
          } else if (e.type === 'text') {
            patch((m) => ({ ...m, content: m.content + e.text }));
          } else if (e.type === 'source') {
            patch((m) => ({ ...m, citations: [...m.citations, e.citation] }));
          } else if (e.type === 'status') {
            setStatus(e.text);
          } else if (e.type === 'done') {
            patch((m) => ({ ...m, id: e.messageId, content: e.content, citations: e.citations, model }));
          } else if (e.type === 'error') {
            throw new Error(e.message);
          }
        }
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ask failed. Try again.');
      // Drop the unfinished answer and give the question back.
      setMessages((all) => all.filter((m) => m.id !== pendingId || m.content));
      setQuestion(q);
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }

  return (
    <div className="grid min-w-0 gap-4">
      {!options.courses.length ? (
        <p role="status" className="border-l-4 border-soon bg-sheet p-3 text-sm">
          No course has AI turned on, so Ask has nothing to use. Courses whose outline allows AI can be turned on in{' '}
          <Link href="/settings/courses" className="text-link underline">
            Settings, Courses
          </Link>
          .
        </p>
      ) : !aiReady ? (
        <p role="status" className="border-l-4 border-soon bg-sheet p-3 text-sm">
          Claude isn&apos;t connected yet, so Ask can&apos;t answer. Add a working Anthropic key in Vercel, then try again.
        </p>
      ) : null}

      <div className="grid min-w-0 gap-4">
        {messages.length ? (
          <ol className="grid gap-6" aria-live="polite">
            {messages.map((m) =>
              m.role === 'user' ? (
                <li key={m.id} className="justify-self-end max-w-[85%] rounded-md bg-sheet px-3 py-2 whitespace-pre-wrap border border-rule">
                  {m.content}
                </li>
              ) : (
                <li key={m.id} className="grid min-w-0 gap-3">
                  {m.content ? (
                    <Markdown className="min-w-0">{withAnchors(m.content, m.id)}</Markdown>
                  ) : (
                    <p className="text-sm text-muted-foreground">{status ?? 'Reading your notes…'}</p>
                  )}
                  <Sources message={m} />
                  {m.model ? <p className="text-xs text-muted-foreground">Answered with {m.model}</p> : null}
                </li>
              ),
            )}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">Ask about {label === 'Everything' ? 'any course with AI on' : label}. Answers cite the notes they use.</p>
        )}
        {busy && status && messages.at(-1)?.content ? <p className="text-sm text-muted-foreground">{status}</p> : null}
      </div>

      {banner ? (
        <section aria-label="AI policy" className="grid gap-1 border-l-4 border-soon bg-sheet p-3 text-sm">
          <p className="font-semibold">{banner.courseCode} AI policy for graded work</p>
          <p>{banner.policy ?? "Runway doesn't have this course's AI policy. Check the outline before using AI on this."}</p>
          <p className="text-muted-foreground">Ask explains the concepts and points to your notes. It won&apos;t write answers to graded questions.</p>
          {banner.outlineUrl ? (
            <a href={banner.outlineUrl} target="_blank" rel="noopener noreferrer" className="text-link underline">
              Open the outline
            </a>
          ) : null}
        </section>
      ) : null}

      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid min-w-0 flex-1 gap-1 text-sm sm:max-w-md">
            <span className="font-semibold">Asking about</span>
            <select className={cn(selectClass, 'w-full')} value={scopeKey(scope)} onChange={(e) => setScope(parseScopeKey(e.target.value))} disabled={busy}>
              {lockCourse ? null : <option value="all">Everything</option>}
              <optgroup label="Courses">
                {courses.map((c) => (
                  <option key={c.id} value={`course:${c.id}`}>
                    {c.code}
                  </option>
                ))}
              </optgroup>
              {notes.length ? (
                <optgroup label="Notes">
                  {notes.map((n) => (
                    <option key={n.id} value={`note:${n.id}`}>
                      {code(n.courseId)} {n.title}
                      {n.lectureOn ? ` (${n.lectureOn})` : ''}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {items.length ? (
                <optgroup label="Deadlines and exams">
                  {items.map((i) => (
                    <option key={i.id} value={`item:${i.id}`}>
                      {code(i.courseId)} {i.title}
                      {i.date ? ` (${i.date})` : ''}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </label>
          <Toggle
            variant="outline"
            pressed={deep}
            onPressedChange={setDeep}
            disabled={busy}
            className="h-11 px-3 sm:h-9"
            aria-label="Deep: use the stronger model for this question"
          >
            <SparklesIcon /> Deep
          </Toggle>
        </div>

        <ul className="flex flex-wrap gap-2" aria-label="Quick prompts">
          {QUICK_PROMPTS.map((p) => (
            <li key={p.key}>
              <Button
                type="button"
                variant="outline"
                className="h-11 sm:h-8"
                disabled={busy}
                onClick={() => {
                  setQuestion(p.text(topic));
                  inputRef.current?.focus();
                }}
              >
                {p.label}
              </Button>
            </li>
          ))}
        </ul>

        <label htmlFor="ask-question" className="sr-only">
          Question
        </label>
        <Textarea
          id="ask-question"
          ref={inputRef}
          rows={3}
          value={question}
          maxLength={4000}
          placeholder="Ask about your notes"
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void ask();
            }
          }}
        />
        {error ? (
          <p role="alert" className="text-sm text-late">
            {error}
          </p>
        ) : null}
        {budgetNotice ? <p className="text-sm text-soon">This month&apos;s AI budget is used up, so Ask is using the cheaper model.</p> : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" className="h-11 sm:h-9" disabled={busy || !question.trim() || !canAsk}>
            {busy ? 'Answering…' : 'Ask'}
          </Button>
          {threadId && !navigate ? (
            <Link href={`/ask/${threadId}`} className="text-sm text-link underline">
              Open this thread
            </Link>
          ) : null}
          <p className="text-xs text-muted-foreground">Enter sends, Shift+Enter adds a line.</p>
        </div>
      </form>
    </div>
  );
}
