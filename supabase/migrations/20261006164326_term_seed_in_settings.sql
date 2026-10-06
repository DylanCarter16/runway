-- Phase 10: the term config leaves git. Each user's own config (courses, sections, rooms,
-- staff, Piazza ids) is stored here and is what "Load term setup" imports; a fresh install
-- with nothing stored loads the made-up example term from src/config/term.example.ts.
-- The settings row already has an owner-only RLS policy.

alter table public.settings
  add column term_seed jsonb;

comment on column public.settings.term_seed is
  'The SeedTerm (src/config/term.template.ts) that Settings, Term loads. Uploaded with npm run term:upload.';
