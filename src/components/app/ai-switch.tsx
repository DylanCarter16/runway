'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { setCourseAi } from '@/app/(app)/settings/actions';

/** A course's AI switch. Turning it on asks for the course code and the instructor's permission. */
export function AiSwitch({ courseId, code, on, policy }: { courseId: string; code: string; on: boolean; policy: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [allows, setAllows] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const codeMatches = typed.replace(/\s+/g, '').toUpperCase() === code.replace(/\s+/g, '').toUpperCase();

  function turnOff() {
    startTransition(async () => {
      const res = await setCourseAi({ courseId, on: false });
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(`AI turned off for ${code}`);
        router.refresh();
      }
    });
  }

  function turnOn() {
    setError(null);
    startTransition(async () => {
      const res = await setCourseAi({ courseId, on: true, confirmCode: typed, instructorAllows: allows });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      toast.success(`AI turned on for ${code}`);
      router.refresh();
    });
  }

  if (on) {
    return (
      <Button variant="outline" className="h-11 w-fit sm:h-8" disabled={isPending} onClick={turnOff}>
        Turn AI off for {code}
      </Button>
    );
  }

  return (
    <>
      <Button variant="outline" className="h-11 w-fit sm:h-8" onClick={() => setOpen(true)}>
        Turn AI on for {code}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Turn AI on for {code}?</DialogTitle>
            <DialogDescription>
              With AI on, {code}&apos;s pastes, notes, emails, and page changes are sent to Claude. Only do this if the course allows it.
            </DialogDescription>
          </DialogHeader>
          {policy ? (
            <blockquote className="border-l-2 border-rule pl-3 text-sm">
              <span className="font-semibold">The outline says: </span>
              {policy}
            </blockquote>
          ) : null}
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              turnOn();
            }}
          >
            <div className="grid gap-1.5">
              <label htmlFor={`ai-code-${courseId}`} className="text-sm font-semibold">
                Type {code} to confirm
              </label>
              <Input id={`ai-code-${courseId}`} className="h-11 sm:h-9" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={allows} onChange={(e) => setAllows(e.target.checked)} />
              The instructor allows AI for this use.
            </label>
            {error ? (
              <p role="alert" className="text-sm text-late">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" className="h-11 sm:h-9" disabled={isPending || !codeMatches || !allows}>
                Turn AI on
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
