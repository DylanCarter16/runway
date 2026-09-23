'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { deleteTerm } from '@/app/(app)/settings/actions';

/** Settings, Data: delete a term after its name is typed out. */
export function DeleteTermButton({ termId, name, courses, items }: { termId: string; name: string; courses: number; items: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const matches = norm(typed) === norm(name);

  function remove() {
    setError(null);
    startTransition(async () => {
      const res = await deleteTerm({ termId, confirmName: typed });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      toast.success(`${name} deleted: ${res.data.courses} ${res.data.courses === 1 ? 'course' : 'courses'}, ${res.data.items} ${res.data.items === 1 ? 'item' : 'items'}`);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="destructive" className="h-11 w-fit sm:h-8" onClick={() => setOpen(true)}>
        Delete {name}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            setTyped('');
            setError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {name}?</DialogTitle>
            <DialogDescription>
              This deletes {courses} {courses === 1 ? 'course' : 'courses'} and {items} {items === 1 ? 'item' : 'items'}, with their links, grades,
              reminders, watched pages, and calendar events. Notes and pastes are kept without a course. It can&apos;t be undone, so export
              first.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              remove();
            }}
          >
            <div className="grid gap-1.5">
              <label htmlFor={`delete-term-${termId}`} className="text-sm font-semibold">
                Type {name} to confirm
              </label>
              <Input
                id={`delete-term-${termId}`}
                className="h-11 sm:h-9"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
              />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-late">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" className="h-11 sm:h-9" disabled={isPending || !matches}>
                {isPending ? 'Deleting' : 'Delete term'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
