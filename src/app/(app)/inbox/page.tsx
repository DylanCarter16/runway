import { EmptyState } from '@/components/app/empty-state';
import { AddItemButton } from '@/components/app/quick-actions';

export const metadata = { title: 'Inbox' };

export default function InboxPage() {
  return (
    <div className="grid gap-6">
      <h2 className="text-2xl font-semibold">Inbox</h2>
      <EmptyState title="The paste box is not built yet." action={<AddItemButton label="Add item" variant="default" />}>
        Until it is, add dates by hand with Add item. Pasted outlines, announcements, and Quest schedules land here next.
      </EmptyState>
      <section id="paste-reminders" className="grid gap-2">
        <h3 className="text-[21px] font-semibold">Paste reminders</h3>
        <p className="text-sm text-muted-foreground">No paste reminders due.</p>
      </section>
    </div>
  );
}
