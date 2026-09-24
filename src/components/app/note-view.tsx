'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { getNoteStatus, rerunCleanup, resetNoteEdit, saveNoteEdit } from '@/app/(app)/notes/actions';
import { side, wordDiff, type DiffPart } from '@/lib/notes/compare';
import { cn } from '@/lib/utils';
import { Markdown } from './markdown';

// The note page's body (SPEC 4.5): Mine, Cleaned, and Compare views, the
// markdown editor with live preview, reset, and re-run with an instruction.
// AI-off notes get only Mine.

type View = 'mine' | 'cleaned' | 'compare';

function DiffText({ parts, className }: { parts: DiffPart[]; className?: string }) {
  return (
    <div className={cn('font-serif text-[17px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]', className)}>
      {parts.map((p, i) =>
        p.kind === 'added' ? (
          <ins key={i} className="rounded-sm bg-[color-mix(in_oklab,var(--tie)_40%,transparent)] no-underline">
            {p.text}
          </ins>
        ) : p.kind === 'removed' ? (
          <del key={i} className="rounded-sm bg-[color-mix(in_oklab,var(--graphite)_18%,transparent)] text-muted-foreground">
            {p.text}
          </del>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </div>
  );
}

function Compare({ original, cleaned }: { original: string; cleaned: string }) {
  const parts = useMemo(() => wordDiff(original, cleaned), [original, cleaned]);
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        <ins className="rounded-sm bg-[color-mix(in_oklab,var(--tie)_40%,transparent)] px-1 no-underline">Added</ins> in the cleaned copy,{' '}
        <del className="rounded-sm bg-[color-mix(in_oklab,var(--graphite)_18%,transparent)] px-1">removed</del> from your original.
      </p>
      {/* Side by side on desktop, one inline diff on mobile. */}
      <div className="hidden gap-6 md:grid md:grid-cols-2">
        <section aria-label="Mine" className="grid content-start gap-2">
          <h3 className="text-sm font-semibold">Mine</h3>
          <DiffText parts={side(parts, 'original')} />
        </section>
        <section aria-label="Cleaned" className="grid content-start gap-2 border-l border-rule pl-6">
          <h3 className="text-sm font-semibold">Cleaned</h3>
          <DiffText parts={side(parts, 'cleaned')} />
        </section>
      </div>
      <DiffText parts={parts} className="md:hidden" />
    </div>
  );
}

export function NoteView({
  noteId,
  original,
  cleaned,
  edited,
  status,
  error,
  aiOn,
  instruction,
}: {
  noteId: string;
  original: string;
  cleaned: string | null;
  edited: string | null;
  status: string;
  error: string | null;
  aiOn: boolean;
  instruction: string | null;
}) {
  const router = useRouter();
  const best = edited ?? cleaned;
  const [view, setView] = useState<View>(aiOn && best ? 'cleaned' : 'mine');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(best ?? '');
  const [confirmReset, setConfirmReset] = useState(false);
  const [rerunOpen, setRerunOpen] = useState(false);
  const [rerunText, setRerunText] = useState(instruction ?? '');
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const working = aiOn && (status === 'pending' || status === 'running');

  // "Cleaning up...": poll until the job finishes, then reload the page's data.
  useEffect(() => {
    if (!working) return;
    let stopped = false;
    let tries = 0;
    let timer: number;
    const tick = async () => {
      const res = await getNoteStatus(noteId);
      if (stopped) return;
      if (res.ok && res.data.status !== 'pending' && res.data.status !== 'running') {
        router.refresh();
        return;
      }
      if (++tries < 60) timer = window.setTimeout(tick, tries < 10 ? 2000 : 5000);
    };
    timer = window.setTimeout(tick, 2000);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [working, noteId, router]);

  function save() {
    setFormError(null);
    startTransition(async () => {
      const res = await saveNoteEdit({ id: noteId, markdown: draft });
      if (!res.ok) {
        setFormError(res.error);
        return;
      }
      toast.success('Saved');
      setEditing(false);
      setView('cleaned');
      router.refresh();
    });
  }

  function reset() {
    startTransition(async () => {
      const res = await resetNoteEdit(noteId);
      if (!res.ok) toast.error(res.error);
      else {
        toast.success("Reset to Claude's copy");
        setConfirmReset(false);
        setDraft(cleaned ?? '');
        router.refresh();
      }
    });
  }

  function rerun() {
    setFormError(null);
    startTransition(async () => {
      const res = await rerunCleanup({ id: noteId, instruction: rerunText.trim() || undefined, replaceEdit: Boolean(edited) });
      if (!res.ok) {
        setFormError(res.error);
        return;
      }
      setRerunOpen(false);
      toast.success('Cleaning up again');
      router.refresh();
    });
  }

  const views: [View, string][] = aiOn
    ? [
        ['mine', 'Mine'],
        ['cleaned', 'Cleaned'],
        ['compare', 'Compare'],
      ]
    : [['mine', 'Mine']];

  return (
    <div className="grid gap-4">
      {aiOn ? (
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="View" className="inline-flex rounded-md border border-rule p-0.5">
            {views.map(([v, label]) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                disabled={v !== 'mine' && !best}
                onClick={() => {
                  setView(v);
                  setEditing(false);
                }}
                className={cn(
                  'h-11 rounded-[5px] px-3 text-sm sm:h-8',
                  view === v ? 'bg-ink text-paper' : 'text-muted-foreground hover:text-foreground',
                  'disabled:opacity-50',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            {best && !editing ? (
              <Button
                variant="outline"
                className="h-11 sm:h-8"
                onClick={() => {
                  setDraft(best);
                  setEditing(true);
                  setView('cleaned');
                }}
              >
                Edit
              </Button>
            ) : null}
            <Button variant="outline" className="h-11 sm:h-8" disabled={working || isPending} onClick={() => setRerunOpen(true)}>
              {best ? 'Re-run cleanup' : 'Clean up'}
            </Button>
          </div>
        </div>
      ) : null}

      {working ? (
        <p role="status" className="text-sm text-muted-foreground">
          Cleaning up... Your original is saved. The cleaned copy appears here when Claude finishes.
        </p>
      ) : null}
      {aiOn && status === 'failed' && error ? (
        <p role="alert" className="text-sm text-late">
          Cleanup failed: {error}
        </p>
      ) : null}
      {edited && !editing && view === 'cleaned' ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>Showing your edited version.</span>
          {confirmReset ? (
            <>
              <span>This drops your edits.</span>
              <Button variant="destructive" className="h-11 sm:h-8" disabled={isPending} onClick={reset}>
                Reset to Claude&apos;s copy
              </Button>
              <Button variant="ghost" className="h-11 sm:h-8" onClick={() => setConfirmReset(false)}>
                Keep my edits
              </Button>
            </>
          ) : (
            <Button variant="ghost" className="h-11 sm:h-8" onClick={() => setConfirmReset(true)}>
              Reset to Claude&apos;s copy
            </Button>
          )}
        </div>
      ) : null}

      {editing ? (
        <div className="grid gap-3">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="grid content-start gap-1.5">
              <label htmlFor="note-edit" className="text-sm font-semibold">
                Markdown
              </label>
              <Textarea id="note-edit" value={draft} onChange={(e) => setDraft(e.target.value)} rows={24} className="min-h-96 font-mono text-[15px]" />
            </div>
            <section aria-label="Preview" className="grid content-start gap-1.5">
              <h3 className="text-sm font-semibold">Preview</h3>
              <div className="rounded-md border border-rule bg-sheet p-4">
                <Markdown>{draft}</Markdown>
              </div>
            </section>
          </div>
          {formError ? (
            <p role="alert" className="text-sm text-late">
              {formError}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button className="h-11 sm:h-9" disabled={isPending} onClick={save}>
              {isPending ? 'Saving...' : 'Save edits'}
            </Button>
            <Button variant="ghost" className="h-11 sm:h-9" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : view === 'mine' ? (
        <section aria-label="Mine" className="grid gap-2">
          <p className="text-sm text-muted-foreground">Exactly as you pasted it.</p>
          <div className="font-serif text-[18px] leading-[1.65] whitespace-pre-wrap [overflow-wrap:anywhere] max-w-[68ch]">{original}</div>
        </section>
      ) : view === 'cleaned' && best ? (
        <Markdown>{best}</Markdown>
      ) : view === 'compare' && best ? (
        <Compare original={original} cleaned={best} />
      ) : null}

      <Dialog open={rerunOpen} onOpenChange={setRerunOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{best ? 'Re-run cleanup' : 'Clean up this note'}</DialogTitle>
            <DialogDescription>Claude cleans your original again. Your original never changes.</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              rerun();
            }}
          >
            <div className="grid gap-1.5">
              <label htmlFor="rerun-instruction" className="text-sm font-semibold">
                Instruction <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Input
                id="rerun-instruction"
                value={rerunText}
                onChange={(e) => setRerunText(e.target.value)}
                maxLength={500}
                placeholder="Put the truth tables in markdown tables"
                className="h-11 sm:h-9"
              />
            </div>
            {edited ? <p className="text-sm text-soon">The new cleaned copy replaces your edited version.</p> : null}
            {formError ? (
              <p role="alert" className="text-sm text-late">
                {formError}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="submit" disabled={isPending} className="h-11 sm:h-9">
                {edited ? 'Replace my edits and clean up' : 'Clean up'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
