import { EmptyState } from '@/components/app/empty-state';

export const metadata = { title: 'New note' };

export default function NewNotePage() {
  return (
    <div className="grid gap-6">
      <h2 className="text-2xl font-semibold">New note</h2>
      <EmptyState title="Saving notes is not built yet.">
        Keep your notes where they are for now. This page will store them word for word and, for STAT 230, add a cleaned copy.
      </EmptyState>
    </div>
  );
}
