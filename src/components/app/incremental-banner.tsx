'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { keepWholePaste } from '@/app/(app)/notes/actions';

/**
 * On a note cut from a running-notes paste or a re-exported file: what was kept and what was
 * skipped, a link to the whole paste, and the undo that makes one note from all of it.
 */
export function IncrementalBanner({ noteId, summary, documentId, isFile }: { noteId: string; summary: string; documentId: string | null; isFile: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <aside className="grid gap-2 rounded-md border border-rule bg-sheet p-3 text-sm">
      <p>
        <span className="font-semibold">{isFile ? 'Only the new pages: ' : 'Only the new material: '}</span>
        {summary}
        {summary.endsWith('.') ? '' : '.'}{' '}
        {isFile ? null : 'Paragraphs you changed are marked "Revised since your last paste".'}{' '}
        {documentId ? (
          <Link href={`/library/${documentId}`} className="text-link underline underline-offset-2">
            {isFile ? 'Open the file' : 'Open the whole paste'}
          </Link>
        ) : null}
      </p>
      <div>
        <Button
          type="button"
          variant="outline"
          className="h-11 sm:h-8"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const res = await keepWholePaste({ noteId });
              if (!res.ok) {
                toast.error(res.error);
                return;
              }
              toast.success('Kept the whole paste as one note');
              router.replace(`/notes/${res.data.id}`);
            })
          }
        >
          {isFile ? 'Undo: keep the whole file as one note' : 'Undo: keep the whole paste as one note'}
        </Button>
      </div>
    </aside>
  );
}
