---
paths:
  - "supabase/**"
  - "src/lib/db/**"
  - "tests/db/**"
---

# Database rules

- Schema changes go in a new migration. Never edit a migration that has been pushed.
- New tables start with `id uuid primary key default gen_random_uuid()`, `user_id uuid not null default auth.uid() references auth.users (id) on delete cascade`, and `created_at timestamptz not null default now()`. Add the table to the RLS loop pattern (owner policy) in the same migration.
- Server-only tables (like `jobs`, `integration_tokens`) enable RLS and add no policies.
- Tables whose rows change after insert get `updated_at` and the `set_updated_at` trigger.
- New functions set `search_path` explicitly. Functions that only the worker may call: `revoke execute ... from public, anon, authenticated`.
- Keep `items (user_id, source, source_ref)` unique; ingest code upserts on it.
- For a newly searchable table, extend `search_all()` in a new migration and add a check to `tests/db/schema-checks.sql`.
- After writing a migration: apply it (CLAUDE.md, Commands, covers local and cloud sessions), then regenerate `src/lib/db/types.ts`. Run `tests/db/run.sh` when a scratch Postgres is available; when it isn't, say so in PROGRESS.md.
- Use `(select auth.uid())` inside policies, not a bare `auth.uid()`.
