'use client';

import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { createItem } from '@/app/(app)/actions';
import { emptyValues, ItemFormFields } from './item-form';
import { useShell } from './shell-provider';

export interface QuickAddDefaults {
  courseId?: string;
  date?: string;
  time?: string;
  kind?: string;
}

export function QuickAddDialog({
  defaults,
  onClose,
  onCreated,
}: {
  defaults: QuickAddDefaults | null;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { courses } = useShell();
  const open = defaults !== null;

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add item</DialogTitle>
        </DialogHeader>
        {open ? (
          <ItemFormFields
            key={JSON.stringify(defaults)}
            courses={courses}
            initial={emptyValues({
              courseId: defaults.courseId ?? '',
              date: defaults.date ?? '',
              time: defaults.time ?? '',
              kind: defaults.kind ?? 'assignment',
            })}
            submitLabel="Add item"
            onCancel={onClose}
            onSubmit={async (form) => {
              const result = await createItem(form);
              if (!result.ok) return result.error;
              toast.success('Added');
              onCreated(result.data.id);
              return null;
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
