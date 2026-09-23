'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { getPasteStatus, pasteText, saveDocumentAsNote, type PasteInput } from '@/app/(app)/inbox/actions';
import type { CourseLite } from '@/lib/db/queries';
import { PASTE_KINDS } from '@/lib/inbox/kinds';
import { selectClass } from '@/lib/ui';
import { useShell } from './shell-provider';

type Outcome =
  | { type: 'duplicate'; href: string; label: string }
  | { type: 'note'; href: string }
  | { type: 'working'; href: string }
  | { type: 'done'; href: string; proposals: number; notes: string[]; documentId: string; suggestNote: boolean; failed: boolean }
  | { type: 'stored'; href: string; courseCode: string | null };

/** "none" means No course; "" means not picked yet. */
type CourseChoice = string;

export function PasteBox({ courses, initialCourse, initialKind }: { courses: CourseLite[]; initialCourse: CourseChoice; initialKind: PasteInput['kind'] }) {
  const router = useRouter();
  const { openQuickAdd } = useShell();
  const [text, setText] = useState('');
  const [course, setCourse] = useState<CourseChoice>(initialCourse);
  const [kind, setKind] = useState<PasteInput['kind']>(initialKind);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [isPending, startTransition] = useTransition();
  const polling = useRef<number | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => () => {
    if (polling.current) window.clearTimeout(polling.current);
  }, []);

  function poll(documentId: string, href: string, courseId: string | null, tries = 0) {
    polling.current = window.setTimeout(async () => {
      const res = await getPasteStatus(documentId);
      if (res.ok && res.data.done) {
        setOutcome({
          type: 'done',
          href,
          documentId,
          proposals: res.data.proposals,
          notes: res.data.notes,
          suggestNote: res.data.suggestNote,
          failed: res.data.status === 'failed',
        });
        router.refresh();
        // Stored without extraction (AI off): offer quick add for any dates.
        if (res.data.status === 'stored_only' && courseId) openQuickAdd({ courseId });
        return;
      }
      if (tries < 40) poll(documentId, href, courseId, tries + 1);
      else setOutcome({ type: 'done', href, documentId, proposals: 0, notes: ['Still working. Proposals appear below when it finishes.'], suggestNote: false, failed: false });
    }, tries < 5 ? 1500 : 3000);
  }

  function save() {
    setError(null);
    if (!course) {
      setError('Pick a course, or No course for term-wide pastes such as the Quest schedule.');
      return;
    }
    const courseId = course === 'none' ? null : course;
    startTransition(async () => {
      const res = await pasteText({ text, courseId, kind });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const data = res.data;
      if (data.status === 'duplicate') {
        setOutcome({ type: 'duplicate', href: data.href, label: data.label });
        return;
      }
      setText('');
      if (data.status === 'note') {
        setOutcome({ type: 'note', href: data.href });
        toast.success('Note saved');
        return;
      }
      if (data.extracting) {
        setOutcome({ type: 'working', href: data.href });
        poll(data.documentId, data.href, courseId);
      } else {
        const code = courses.find((c) => c.id === courseId)?.code ?? null;
        setOutcome({ type: 'stored', href: data.href, courseCode: code });
        router.refresh();
        // AI-off course: nothing is extracted, so offer quick add for any dates.
        if (courseId) openQuickAdd({ courseId });
      }
    });
  }

  async function fromClipboard() {
    try {
      const clip = await navigator.clipboard.readText();
      setText(clip);
      area.current?.focus();
    } catch {
      setError('The browser blocked clipboard access. Paste into the box instead.');
    }
  }

  return (
    <section aria-labelledby="paste-heading" className="grid gap-3">
      <h3 id="paste-heading" className="sr-only">
        Paste box
      </h3>
      <label htmlFor="paste-text" className="sr-only">
        Pasted text
      </label>
      <Textarea
        ref={area}
        id="paste-text"
        rows={8}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste anything: an outline, an announcement, your Quest schedule, an Odyssey exam row, grades..."
        className="min-h-40 font-serif text-[16px]"
      />
      <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end">
        <div className="grid gap-1.5">
          <label htmlFor="paste-course" className="text-sm font-semibold">
            Course
          </label>
          <select id="paste-course" className={selectClass} value={course} onChange={(e) => setCourse(e.target.value)} required>
            <option value="">Pick a course</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
                {c.ai_allowed ? '' : ' (AI off)'}
              </option>
            ))}
            <option value="none">No course</option>
          </select>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="paste-kind" className="text-sm font-semibold">
            Kind
          </label>
          <select id="paste-kind" className={selectClass} value={kind} onChange={(e) => setKind(e.target.value as PasteInput['kind'])}>
            {PASTE_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <Button type="button" variant="outline" className="h-11 sm:hidden" onClick={fromClipboard}>
          Paste from clipboard
        </Button>
        <Button type="button" className="h-11 sm:h-9" onClick={save} disabled={isPending || !text.trim()}>
          {isPending ? 'Saving' : kind === 'lecture_notes' ? 'Save note' : 'Save'}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-late">
          {error}
        </p>
      ) : null}
      <div aria-live="polite" className="text-sm">
        {outcome?.type === 'duplicate' ? (
          <p>
            Already saved:{' '}
            <Link href={outcome.href} className="text-tie underline underline-offset-2">
              {outcome.label}
            </Link>
            . Nothing new was created.
          </p>
        ) : null}
        {outcome?.type === 'note' ? (
          <p>
            Saved as a lecture note.{' '}
            <Link href={outcome.href} className="text-tie underline underline-offset-2">
              Open notes
            </Link>
          </p>
        ) : null}
        {outcome?.type === 'working' ? <p className="text-muted-foreground">Saved. Reading it now...</p> : null}
        {outcome?.type === 'stored' ? (
          <p>
            Saved to the{' '}
            <Link href={outcome.href} className="text-tie underline underline-offset-2">
              Library
            </Link>
            .{' '}
            {outcome.courseCode
              ? `${outcome.courseCode} has AI turned off, so nothing was read from it. Add any dates with Add item.`
              : 'No course was picked, so nothing was read from it.'}
          </p>
        ) : null}
        {outcome?.type === 'done' ? (
          <div className="grid gap-1">
            <p>
              {outcome.failed
                ? 'Saved, but reading it failed.'
                : outcome.proposals
                  ? `Saved. ${outcome.proposals} ${outcome.proposals === 1 ? 'change' : 'changes'} to review below.`
                  : outcome.suggestNote
                    ? 'Saved. This looks like lecture notes.'
                    : 'Saved. Nothing new to review.'}{' '}
              <Link href={outcome.href} className="text-tie underline underline-offset-2">
                Open in Library
              </Link>
            </p>
            {outcome.notes.map((n) => (
              <p key={n} className="text-muted-foreground">
                {n}
              </p>
            ))}
            {outcome.suggestNote ? (
              <div>
                <Button
                  variant="outline"
                  className="h-11 sm:h-8"
                  onClick={async () => {
                    const res = await saveDocumentAsNote(outcome.documentId);
                    if (!res.ok) toast.error(res.error);
                    else {
                      toast.success('Note saved');
                      router.push(res.data.href);
                    }
                  }}
                >
                  Save as a note
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
