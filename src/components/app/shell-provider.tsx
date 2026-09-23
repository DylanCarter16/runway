'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { CourseLite } from '@/lib/db/queries';
import { CommandPalette } from './palette';
import { ItemDrawer } from './item-drawer';
import { QuickAddDialog, type QuickAddDefaults } from './quick-add';
import { ShortcutsDialog } from './shortcuts';

interface Shell {
  courses: CourseLite[];
  openPalette: () => void;
  openQuickAdd: (defaults?: QuickAddDefaults) => void;
  openItem: (id: string) => void;
}

const ShellContext = createContext<Shell | null>(null);

export function useShell(): Shell {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShell must be used inside ShellProvider');
  return ctx;
}

const G_TARGETS: Record<string, string> = { t: '/', c: '/calendar', i: '/inbox', n: '/notes', a: '/ask' };

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function ShellProvider({ courses, children }: { courses: CourseLite[]; children: ReactNode }) {
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [quickAdd, setQuickAdd] = useState<QuickAddDefaults | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const pendingG = useRef<number | null>(null);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const openQuickAdd = useCallback((defaults?: QuickAddDefaults) => setQuickAdd(defaults ?? {}), []);
  const openItem = useCallback((id: string) => setItemId(id), []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (pendingG.current !== null) {
        window.clearTimeout(pendingG.current);
        pendingG.current = null;
        const to = G_TARGETS[event.key];
        if (to) {
          event.preventDefault();
          router.push(to);
        }
        return;
      }
      if (event.key === '/') {
        event.preventDefault();
        setPaletteOpen(true);
      } else if (event.key === '?') {
        event.preventDefault();
        setShortcutsOpen(true);
      } else if (event.key === 'g') {
        pendingG.current = window.setTimeout(() => (pendingG.current = null), 1200);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);

  const value = useMemo(
    () => ({ courses, openPalette, openQuickAdd, openItem }),
    [courses, openPalette, openQuickAdd, openItem],
  );

  return (
    <ShellContext.Provider value={value}>
      {children}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <QuickAddDialog
        defaults={quickAdd}
        onClose={() => setQuickAdd(null)}
        onCreated={(id) => {
          setQuickAdd(null);
          setItemId(id);
        }}
      />
      <ItemDrawer itemId={itemId} onClose={() => setItemId(null)} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </ShellContext.Provider>
  );
}
