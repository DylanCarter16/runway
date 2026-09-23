import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/app/empty-state';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Notes' };

export default function NotesPage() {
  return (
    <div className="grid gap-6">
      <h2 className="text-2xl font-semibold">Notes</h2>
      <EmptyState
        title="No notes yet."
        action={
          <Link href="/notes/new" className={cn(buttonVariants(), 'h-11 sm:h-9')}>
            Paste notes
          </Link>
        }
      >
        Paste today&apos;s lecture notes to keep them searchable.
      </EmptyState>
    </div>
  );
}
