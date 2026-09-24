'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { keepWholePaste } from '@/app/(app)/notes/actions';

/** A running-notes paste with nothing new: says so, and offers to keep it whole anyway. */
export function NothingNew({ documentId, decision }: { documentId: string; decision: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <div role="status" className="grid gap-2">
      <p>
        {decision} The whole paste is stored in the Library, and no note was made.
      </p>
      <div>
        <Button
          type="button"
          variant="outline"
          className="h-11 sm:h-8"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const res = await keepWholePaste({ documentId });
              if (!res.ok) {
                toast.error(res.error);
                return;
              }
              toast.success('Note saved');
              router.push(`/notes/${res.data.id}`);
            })
          }
        >
          Keep the whole paste as one note
        </Button>
      </div>
    </div>
  );
}
