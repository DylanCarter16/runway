'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ArrowDownIcon, ArrowUpIcon, ExternalLinkIcon, PencilIcon, PinIcon, PinOffIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { deleteLink, moveLink, saveLink, setLinkPinned, type LinkForm } from '@/app/(app)/actions';
import { selectClass } from '@/lib/ui';

export interface LinkRow {
  id: string;
  course_id: string | null;
  label: string;
  url: string;
  category: string;
  where_to_find: string | null;
  pinned: boolean;
  sort_order: number;
}

export const CATEGORY_LABEL: Record<string, string> = {
  course_site: 'Course site',
  discussion: 'Discussion',
  lms: 'LEARN and course materials',
  submission: 'Submission',
  grades: 'Grades and feedback',
  notes: 'Notes',
  exam: 'Exams',
  outline: 'Outline',
  office_hours: 'Office hours',
  contact: 'Contacts',
  policy: 'Policies',
  other: 'Other',
};

function LinkDialog({
  courseId,
  link,
  open,
  onClose,
}: {
  courseId: string | null;
  link: LinkRow | null;
  open: boolean;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(link?.label ?? '');
  const [url, setUrl] = useState(link?.url ?? 'https://');
  const [category, setCategory] = useState(link?.category ?? 'other');
  const [where, setWhere] = useState(link?.where_to_find ?? '');
  const [pinned, setPinned] = useState(link?.pinned ?? false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(e: FormEvent) {
    e.preventDefault();
    const form: LinkForm = {
      courseId,
      label,
      url: url.trim(),
      category: category as LinkForm['category'],
      whereToFind: where.trim() || null,
      pinned,
    };
    startTransition(async () => {
      const result = await saveLink(link?.id ?? null, form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(link ? 'Saved' : 'Link added');
      onClose();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{link ? 'Edit link' : 'Add link'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <label className="grid gap-1.5 text-sm">
            <span className="font-semibold">Label</span>
            <Input className="h-11 sm:h-9" value={label} onChange={(e) => setLabel(e.target.value)} required autoFocus />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-semibold">URL</span>
            <Input className="h-11 sm:h-9" type="url" value={url} onChange={(e) => setUrl(e.target.value)} required />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-semibold">Category</span>
            <select className={selectClass} value={category} onChange={(e) => setCategory(e.target.value)}>
              {Object.entries(CATEGORY_LABEL).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-semibold">Where to find it (optional)</span>
            <Textarea rows={3} value={where} onChange={(e) => setWhere(e.target.value)} />
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-(--mark)" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
            Pin to the course header
          </label>
          {error ? (
            <p role="alert" className="text-sm text-late">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="h-11 sm:h-9" disabled={isPending}>
              {link ? 'Save link' : 'Add link'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Links grouped by category, with add, edit, pin, reorder, and delete. */
export function LinksManager({ courseId, links }: { courseId: string | null; links: LinkRow[] }) {
  const [editing, setEditing] = useState<LinkRow | 'new' | null>(null);
  const [, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) toast.error(result.error ?? 'That did not work.');
      else if (done) toast.success(done);
    });

  const sorted = [...links].sort((a, b) => a.sort_order - b.sort_order);
  const categories = Object.keys(CATEGORY_LABEL).filter((c) => sorted.some((l) => l.category === c));

  return (
    <div className="grid gap-6">
      <div>
        <Button className="h-11 sm:h-9" onClick={() => setEditing('new')}>
          <PlusIcon /> Add link
        </Button>
      </div>
      {!sorted.length ? <p className="text-sm text-muted-foreground">No links yet. Add the course site, Piazza, or anything you open often.</p> : null}
      {categories.map((cat) => (
        <section key={cat} className="grid gap-1">
          <h3 className="text-base font-semibold">{CATEGORY_LABEL[cat]}</h3>
          <ul className="divide-y divide-rule border-y border-rule">
            {sorted
              .filter((l) => l.category === cat)
              .map((l) => {
                const index = sorted.indexOf(l);
                return (
                  <li key={l.id} className="grid gap-1 py-2 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div className="min-w-0">
                      <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 font-semibold text-link underline-offset-2 hover:underline sm:min-h-0">
                        {l.label}
                        <ExternalLinkIcon className="size-4" aria-hidden />
                      </a>
                      {l.pinned ? <span className="ml-2 text-xs text-muted-foreground">Pinned</span> : null}
                      <p className="truncate text-xs text-muted-foreground">{l.url}</p>
                      {l.where_to_find ? <p className="text-sm text-muted-foreground">{l.where_to_find}</p> : null}
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon-lg" className="size-11 sm:size-9" aria-label={l.pinned ? `Unpin ${l.label}` : `Pin ${l.label}`} onClick={() => run(() => setLinkPinned(l.id, !l.pinned), l.pinned ? 'Unpinned' : 'Pinned')}>
                        {l.pinned ? <PinOffIcon /> : <PinIcon />}
                      </Button>
                      <Button variant="ghost" size="icon-lg" className="size-11 sm:size-9" aria-label={`Move ${l.label} up`} disabled={index === 0} onClick={() => run(() => moveLink(l.id, 'up'))}>
                        <ArrowUpIcon />
                      </Button>
                      <Button variant="ghost" size="icon-lg" className="size-11 sm:size-9" aria-label={`Move ${l.label} down`} disabled={index === sorted.length - 1} onClick={() => run(() => moveLink(l.id, 'down'))}>
                        <ArrowDownIcon />
                      </Button>
                      <Button variant="ghost" size="icon-lg" className="size-11 sm:size-9" aria-label={`Edit ${l.label}`} onClick={() => setEditing(l)}>
                        <PencilIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-lg"
                        className="size-11 sm:size-9"
                        aria-label={`Delete ${l.label}`}
                        onClick={() => {
                          if (window.confirm(`Delete the link "${l.label}"?`)) run(() => deleteLink(l.id), 'Deleted');
                        }}
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
      {editing ? (
        <LinkDialog
          key={editing === 'new' ? 'new' : editing.id}
          courseId={courseId}
          link={editing === 'new' ? null : editing}
          open
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
