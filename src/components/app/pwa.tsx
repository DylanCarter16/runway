'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatAgo } from '@/lib/time';

// ---------------------------------------------------------------------------
// Install state, shared by the registration and the Settings block
// ---------------------------------------------------------------------------

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallState = 'unknown' | 'installed' | 'prompt' | 'ios' | 'manual';

let deferred: InstallPromptEvent | null = null;
let justInstalled = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

function subscribeInstall(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function installState(): InstallState {
  if (justInstalled || window.matchMedia('(display-mode: standalone)').matches) return 'installed';
  if ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone) return 'installed';
  if (deferred) return 'prompt';
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return 'ios';
  return 'manual';
}

function onBeforeInstall(e: Event) {
  // Keep the browser's prompt for the Install app button instead of its own banner.
  e.preventDefault();
  deferred = e as InstallPromptEvent;
  notify();
}

function onInstalled() {
  deferred = null;
  justInstalled = true;
  notify();
}

/**
 * Registers the service worker (production builds only; dev reloads would fight it), asks it to
 * save Today and Calendar for offline use, and listens for the browser's install prompt.
 */
export function ServiceWorker() {
  useEffect(() => {
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .then(() => navigator.serviceWorker.ready)
        .then((reg) => reg.active?.postMessage({ type: 'warm' }))
        .catch(() => {
          // No offline copy this time; the app works the same online.
        });
    }
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);
  return null;
}

// ---------------------------------------------------------------------------
// Offline banner
// ---------------------------------------------------------------------------

const SAVED_COPY_ATTR = 'data-saved-copy';

function subscribeOnline(fn: () => void) {
  const back = () => {
    // Back online: pages load from the network again, so the saved-copy note no longer applies.
    document.documentElement.removeAttribute(SAVED_COPY_ATTR);
    fn();
  };
  window.addEventListener('online', back);
  window.addEventListener('offline', fn);
  return () => {
    window.removeEventListener('online', back);
    window.removeEventListener('offline', fn);
  };
}

/** 'online', 'offline', or 'saved:<ISO time>' when public/sw.js served its saved copy of the page. */
function connection(): string {
  const saved = document.documentElement.getAttribute(SAVED_COPY_ATTR);
  if (saved !== null) return `saved:${saved}`;
  return navigator.onLine ? 'online' : 'offline';
}

/** Shown while offline, and on a saved copy of Today or Calendar (with how old it is). */
export function OfflineBanner() {
  const state = useSyncExternalStore(subscribeOnline, connection, () => 'online');
  if (state === 'online') return null;
  const savedAt = state.startsWith('saved:') ? new Date(state.slice(6)) : null;
  const age = savedAt && !Number.isNaN(savedAt.getTime()) ? `This copy was saved ${formatAgo(savedAt, new Date())}. ` : '';
  return (
    <p role="status" className="mb-4 flex items-start gap-2 rounded-md border border-rule bg-sheet px-3 py-2 text-sm">
      <WifiOff className="mt-0.5 size-4.5 shrink-0 text-graphite" strokeWidth={1.75} aria-hidden />
      <span>
        You&apos;re offline. {age}Changes won&apos;t save until you&apos;re back online.
      </span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// Settings block
// ---------------------------------------------------------------------------

/** Settings, Integrations: install Runway to the home screen. */
export function InstallApp() {
  const state = useSyncExternalStore(subscribeInstall, installState, () => 'unknown' as const);

  async function install() {
    if (!deferred) return;
    const event = deferred;
    await event.prompt();
    await event.userChoice;
    deferred = null;
    notify();
  }

  switch (state) {
    case 'unknown':
      return null;
    case 'installed':
      return <p className="text-sm font-semibold">Runway is installed on this device.</p>;
    case 'prompt':
      return (
        <div>
          <Button className="h-11 sm:h-9" onClick={() => void install()}>
            Install app
          </Button>
        </div>
      );
    case 'ios':
      return <p className="text-sm">Tap Share, then Add to Home Screen.</p>;
    case 'manual':
      return (
        <p className="text-sm">
          This browser has no install button here. In Chrome or Edge, open the browser menu and choose Install Runway. On an
          iPhone, use Safari&apos;s Share, then Add to Home Screen.
        </p>
      );
  }
}
