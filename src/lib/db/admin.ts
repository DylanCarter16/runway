import { createClient } from '@supabase/supabase-js';
import { clientEnv, serverEnv } from '@/env';
import type { Database } from './types';

/**
 * Service-role client. Import only from src/app/api/(cron|jobs|ingest|digest)
 * and src/lib/jobs — never from client code or user-facing server actions.
 */
export function createAdminClient() {
  return createClient<Database>(clientEnv.NEXT_PUBLIC_SUPABASE_URL, serverEnv.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
