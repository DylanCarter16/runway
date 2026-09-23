'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { getItemDetail, type ItemDetail } from '@/app/(app)/actions';
import { ItemDetailView } from './item-detail';

export function ItemDrawer({ itemId, onClose }: { itemId: string | null; onClose: () => void }) {
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!itemId) return;
    let cancelled = false;
    getItemDetail(itemId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setDetail(result.data);
        setError(null);
      } else {
        setError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [itemId, version]);

  // Reload after edits so the drawer shows the saved values and history.
  useEffect(() => {
    if (!itemId) return;
    const onFocus = () => setVersion((v) => v + 1);
    window.addEventListener('runway:item-changed', onFocus);
    return () => window.removeEventListener('runway:item-changed', onFocus);
  }, [itemId]);

  // Close when a link inside the drawer navigates away.
  const pathname = usePathname();
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current !== pathname && itemId) onClose();
    lastPath.current = pathname;
  }, [pathname, itemId, onClose]);

  const current = detail && detail.item?.id === itemId ? detail : null;

  return (
    <Sheet
      open={itemId !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          setDetail(null);
        }
      }}
    >
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="text-xl font-semibold">{current?.item?.title ?? (error ? 'Item not found' : 'Loading')}</SheetTitle>
          <SheetDescription className="sr-only">Item details</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          {error ? <p className="text-sm text-late">{error}</p> : null}
          {current ? <ItemDetailView detail={current} inDrawer key={JSON.stringify(current.item)} /> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
