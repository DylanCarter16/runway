'use client';

import { createBrowserClient } from '@supabase/ssr';
import { clientEnv } from '@/env';
import type { Database } from './types';

let client: ReturnType<typeof createBrowserClient<Database>> | undefined;

/**
 * One memoized client for the whole browser session. Never create a
 * Supabase client in a component body or pass one through a hook
 * dependency list — that caused infinite render loops in a past project.
 */
export function getBrowserClient() {
  if (!client) {
    client = createBrowserClient<Database>(
      clientEnv.NEXT_PUBLIC_SUPABASE_URL,
      clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    );
  }
  return client;
}
