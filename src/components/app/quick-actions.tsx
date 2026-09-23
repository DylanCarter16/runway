'use client';

import Link from 'next/link';
import { ClipboardPasteIcon, MessageCircleQuestionIcon, PlusIcon } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useShell } from './shell-provider';
import type { QuickAddDefaults } from './quick-add';

export function QuickActions() {
  const { openQuickAdd } = useShell();
  return (
    <div className="flex flex-wrap gap-2">
      <Link href="/inbox" className={cn(buttonVariants(), 'h-11 sm:h-9')}>
        <ClipboardPasteIcon /> Paste
      </Link>
      <Button variant="outline" className="h-11 sm:h-9" onClick={() => openQuickAdd()}>
        <PlusIcon /> Add item
      </Button>
      <Link href="/ask" className={cn(buttonVariants({ variant: 'outline' }), 'h-11 sm:h-9')}>
        <MessageCircleQuestionIcon /> Ask
      </Link>
    </div>
  );
}

/** A button that opens quick add with preset fields. */
export function AddItemButton({
  defaults,
  label = 'Add item',
  variant = 'outline',
  className,
}: {
  defaults?: QuickAddDefaults;
  label?: string;
  variant?: 'outline' | 'default' | 'ghost' | 'link';
  className?: string;
}) {
  const { openQuickAdd } = useShell();
  return (
    <Button variant={variant} className={cn('h-11 sm:h-9', className)} onClick={() => openQuickAdd(defaults)}>
      {label}
    </Button>
  );
}

/** Opens an item in the drawer. */
export function OpenItemButton({ id, children, className }: { id: string; children: React.ReactNode; className?: string }) {
  const { openItem } = useShell();
  return (
    <button type="button" onClick={() => openItem(id)} className={cn('text-left', className)}>
      {children}
    </button>
  );
}
