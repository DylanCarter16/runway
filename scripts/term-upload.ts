// Stores your term config in your settings row, where "Load term setup" reads it (Phase 10).
// The config lives in src/config/term.local.ts (gitignored; copy term.example.ts to start).
// Usage: npm run term:upload   (reads .env.local: NEXT_PUBLIC_SUPABASE_URL,
// SUPABASE_SECRET_KEY, and ALLOWED_EMAIL, the account the config belongs to)
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { parseSeedTerm } from '../src/lib/term/active';

async function main() {
  const file = path.resolve('src/config/term.local.ts');
  if (!existsSync(file)) throw new Error('No src/config/term.local.ts. Copy src/config/term.example.ts there and fill it in.');
  // A computed path, so a fresh clone without the file still type-checks.
  const mod = (await import(pathToFileURL(file).href)) as { TERM_LOCAL?: unknown };
  const { term, problem } = parseSeedTerm(mod.TERM_LOCAL);
  if (!term) throw new Error(`term.local.ts must export TERM_LOCAL, a valid term config. ${problem ?? ''}`);

  const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SECRET_KEY: key, ALLOWED_EMAIL: email } = process.env;
  if (!url || !key || !email) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, and ALLOWED_EMAIL (in .env.local).');
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { data: users, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) throw listErr;
  const user = users.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) throw new Error('No account with the ALLOWED_EMAIL address yet. Sign in once, then run this again.');
  const { error } = await admin.from('settings').upsert({ user_id: user.id, term_seed: term }, { onConflict: 'user_id' });
  if (error) throw error;
  console.log(`Stored ${term.name} (${term.courses.length} courses). Settings, Term now loads it.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
