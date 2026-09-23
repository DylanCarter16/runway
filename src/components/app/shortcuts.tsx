'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const SHORTCUTS: [string, string][] = [
  ['Ctrl K or Cmd K', 'Open search'],
  ['/', 'Open search'],
  ['g then t', 'Go to Today'],
  ['g then c', 'Go to Calendar'],
  ['g then i', 'Go to Inbox'],
  ['g then n', 'Go to Notes'],
  ['g then a', 'Go to Ask'],
  ['t', 'Jump to today on the Calendar'],
  ['?', 'Show these shortcuts'],
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <dl className="divide-y divide-rule">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys + what} className="flex justify-between gap-4 py-2 text-sm">
              <dt className="font-semibold">{keys}</dt>
              <dd className="text-muted-foreground">{what}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
