'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { approveAllForDocument, approveProposal, dismissProposal } from '@/app/(app)/inbox/actions';
import type { CourseLite } from '@/lib/db/queries';
import type { CardText } from '@/lib/inbox/describe';
import { cn } from '@/lib/utils';
import { ItemFormFields, type ItemFormValues } from './item-form';

export interface ReviewCard extends CardText {
  id: string;
  courseColor: string | null;
  evidence: string | null;
  sourceLine: string;
  sourceHref: string | null;
  edit: { type: 'item'; initial: ItemFormValues } | { type: 'text'; initial: string } | null;
}

export interface ReviewGroup {
  key: string;
  title: string;
  href: string | null;
  documentId: string | null;
  cards: ReviewCard[];
}

function Card({ card, courses, onGone }: { card: ReviewCard; courses: CourseLite[]; onGone: (id: string) => void }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(card.edit?.type === 'text' ? card.edit.initial : '');
  const [isPending, startTransition] = useTransition();
  const [leaving, setLeaving] = useState(false);

  function finish(message: string) {
    toast.success(message);
    setLeaving(true);
    setTimeout(() => {
      onGone(card.id);
      router.refresh();
    }, 150);
  }

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, message: string) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error ?? 'That failed.');
      else finish(message);
    });
  }

  return (
    <li
      className={cn(
        'grid gap-2 rounded-md border border-rule bg-sheet p-4 transition-all duration-150 motion-reduce:transition-none',
        leaving && 'max-h-0 overflow-hidden py-0 opacity-0',
      )}
      style={card.courseColor ? { borderLeft: `3px solid ${card.courseColor}` } : undefined}
    >
      <p className="font-semibold">{card.headline}</p>
      {card.rows.length ? (
        <dl className="grid gap-1 text-sm tabular">
          {card.rows.map((r) => (
            <div key={r.label} className="flex flex-wrap gap-x-2">
              <dt className="text-muted-foreground">{r.label}</dt>
              <dd>
                {r.before !== null ? (
                  <>
                    <s className="text-muted-foreground">{r.before}</s> <span className="sr-only">changes to</span>
                    <span aria-hidden> to </span>
                  </>
                ) : null}
                {r.after}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {card.body ? <p className="max-w-[68ch] text-sm whitespace-pre-line">{card.body}</p> : null}
      {card.evidence ? <blockquote className="border-l-2 border-rule pl-3 font-serif text-sm text-muted-foreground">&ldquo;{card.evidence}&rdquo;</blockquote> : null}
      <p className="text-xs text-muted-foreground">
        {card.sourceHref ? (
          <Link href={card.sourceHref} className="underline underline-offset-2">
            {card.sourceLine}
          </Link>
        ) : (
          card.sourceLine
        )}
      </p>

      {editing && card.edit?.type === 'item' ? (
        <div className="rounded-md border border-rule p-3">
          <ItemFormFields
            courses={courses}
            initial={card.edit.initial}
            full
            submitLabel="Approve"
            onCancel={() => setEditing(false)}
            onSubmit={async (form) => {
              const res = await approveProposal(card.id, {
                type: 'item',
                courseId: form.courseId,
                kind: form.kind,
                title: form.title,
                date: form.date,
                time: form.time,
                location: form.location ?? null,
                seat: form.seat ?? null,
                weight: form.weight,
              });
              if (!res.ok) return res.error;
              finish('Approved');
              return null;
            }}
          />
        </div>
      ) : null}
      {editing && card.edit?.type === 'text' ? (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            act(() => approveProposal(card.id, { type: 'text', value: text }), 'Approved');
          }}
        >
          <label htmlFor={`edit-${card.id}`} className="text-sm font-semibold">
            Text to save
          </label>
          <Textarea id={`edit-${card.id}`} rows={4} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" className="h-11 sm:h-9" disabled={isPending}>
              Approve
            </Button>
          </div>
        </form>
      ) : null}

      {!editing ? (
        <div className="flex flex-wrap gap-2">
          <Button className="h-11 sm:h-8" disabled={isPending} onClick={() => act(() => approveProposal(card.id), 'Approved')}>
            Approve
          </Button>
          {card.edit ? (
            <Button variant="outline" className="h-11 sm:h-8" disabled={isPending} onClick={() => setEditing(true)}>
              Edit
            </Button>
          ) : null}
          <Button variant="ghost" className="h-11 sm:h-8" disabled={isPending} onClick={() => act(() => dismissProposal(card.id), 'Dismissed')}>
            Dismiss
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function BulkApprove({ group, onDone }: { group: ReviewGroup; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  if (!group.documentId || group.cards.length < 2) return null;
  const documentId = group.documentId;
  return (
    <>
      <Button variant="outline" className="h-11 sm:h-8" onClick={() => setOpen(true)}>
        Approve all {group.cards.length}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Approve all {group.cards.length} changes?</DialogTitle>
            <DialogDescription>
              Every pending change from &ldquo;{group.title}&rdquo; is applied as shown. Check the dates first: they were read from free text.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="h-11 sm:h-9" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              className="h-11 sm:h-9"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const res = await approveAllForDocument(documentId);
                  setOpen(false);
                  if (!res.ok) {
                    toast.error(res.error);
                    return;
                  }
                  if (res.data.failed.length) toast.error(`${res.data.failed.length} could not be approved: ${res.data.failed[0]}`);
                  if (res.data.approved) toast.success(`Approved ${res.data.approved}`);
                  onDone();
                })
              }
            >
              Approve all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ReviewQueue({ groups, courses }: { groups: ReviewGroup[]; courses: CourseLite[] }) {
  const router = useRouter();
  const [gone, setGone] = useState<Set<string>>(new Set());
  const visible = groups
    .map((g) => ({ ...g, cards: g.cards.filter((c) => !gone.has(c.id)) }))
    .filter((g) => g.cards.length);
  const total = visible.reduce((n, g) => n + g.cards.length, 0);

  return (
    <section id="review" aria-labelledby="review-heading" className="grid gap-4">
      <h3 id="review-heading" className="text-[21px] font-semibold">
        Review{total ? ` (${total})` : ''}
      </h3>
      {!total ? <p className="text-sm text-muted-foreground">Nothing to review. Changes read from pastes and syncs wait here for your approval.</p> : null}
      {visible.map((g) => (
        <div key={g.key} className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {g.href ? (
                <Link href={g.href} className="underline underline-offset-2">
                  {g.title}
                </Link>
              ) : (
                g.title
              )}
            </p>
            <BulkApprove group={g} onDone={() => router.refresh()} />
          </div>
          <ul className="grid gap-3">
            {g.cards.map((c) => (
              <Card key={c.id} card={c} courses={courses} onGone={(id) => setGone((s) => new Set(s).add(id))} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
