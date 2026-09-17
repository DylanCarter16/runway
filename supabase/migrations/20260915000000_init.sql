-- Runway: initial schema
-- Single-user app. Every user-facing row carries user_id and an owner-only RLS policy.
-- jobs and integration_tokens are server-only: RLS on, no policies, service role access only.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Terms and courses
-- ---------------------------------------------------------------------------

create table public.terms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  code text not null,                          -- Waterloo term code, '1269' = Fall 2026
  name text not null,
  starts_on date not null,
  ends_on date not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, code)
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  term_id uuid not null references public.terms (id) on delete cascade,
  code text not null,                          -- 'CS 251'
  slug text not null,                          -- 'cs251'
  title text not null,
  color text not null default '#5C6576',
  color_dark text not null default '#A3B0AB',
  sort_order int not null default 0,
  site_url text,
  outline_url text,
  submission_platforms text[] not null default '{}',
  late_policy text,
  remark_policy text,
  ai_policy text,
  ai_allowed boolean not null default false,   -- false: nothing from this course is sent to Claude
  grading_scheme jsonb not null default '[]',  -- [{component, weight_percent, notes}]
  office_hours jsonb not null default '[]',    -- [{who, when, where, notes}]
  staff jsonb not null default '[]',           -- [{name, role, email, notes}]
  meetings jsonb not null default '[]',        -- from the Quest paste: [{component, section, days, start, end, location}]
  checklist jsonb not null default '[]',       -- submission checklist strings
  external_ids jsonb not null default '{}',    -- {piazza_nid, learn_names: [], crowdmark}
  info_notes text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, term_id, slug)
);

create table public.links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id uuid references public.courses (id) on delete cascade,  -- null = global link
  label text not null,
  url text not null,
  category text not null default 'other' check (category in (
    'course_site', 'discussion', 'lms', 'submission', 'grades', 'notes',
    'exam', 'outline', 'office_hours', 'contact', 'policy', 'other')),
  where_to_find text,
  pinned boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique nulls not distinct (user_id, course_id, url)
);

-- ---------------------------------------------------------------------------
-- Library: every raw input the app receives, stored verbatim
-- ---------------------------------------------------------------------------

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id uuid references public.courses (id) on delete set null,
  kind text not null check (kind in (
    'outline', 'announcement', 'piazza_email', 'piazza_resources', 'crowdmark_email',
    'crowdmark_assessment', 'page_snapshot', 'assignment_pdf', 'assignment_header',
    'quest_schedule', 'odyssey_paste', 'grade_paste', 'resource', 'other')),
  title text not null,
  source_url text,
  source_ref text,                             -- Gmail message id, page URL, etc.
  raw_text text not null,
  raw_html text,
  storage_path text,                           -- object in the private 'library' bucket: <user_id>/...
  content_hash text not null,                  -- sha256 of raw_text
  captured_at timestamptz not null default now(),
  meta jsonb not null default '{}',
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  search tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', left(raw_text, 400000)), 'B')
  ) stored,
  unique (user_id, kind, content_hash)
);

create unique index documents_email_ref
  on public.documents (user_id, kind, source_ref)
  where source_ref is not null and kind in ('piazza_email', 'crowdmark_email');

create or replace function public.protect_document_raw()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.raw_text is distinct from old.raw_text or new.content_hash is distinct from old.content_hash then
    raise exception 'documents.raw_text is immutable; store a new document instead';
  end if;
  return new;
end;
$$;

create trigger documents_protect_raw
before update on public.documents
for each row execute function public.protect_document_raw();

-- ---------------------------------------------------------------------------
-- Items: deadlines, exams, breaks, admin dates
-- ---------------------------------------------------------------------------

create table public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id uuid references public.courses (id) on delete cascade,
  kind text not null check (kind in (
    'assignment', 'quiz', 'midterm', 'final', 'project', 'tutorial', 'lab',
    'reading', 'admin', 'break', 'other')),
  title text not null,
  description text,
  starts_at timestamptz,                       -- exams, breaks
  due_at timestamptz,                          -- deadlines; null = undated (feeds the coverage check)
  ends_at timestamptz,
  all_day boolean not null default false,
  time_known boolean not null default true,
  location text,
  seat text,
  weight_percent numeric(5, 2),
  flags text[] not null default '{}',          -- date_tba, time_depends_on_section, outline_date_conflict, ...
  state text not null default 'active' check (state in ('active', 'dismissed')),
  progress text not null default 'todo' check (progress in ('todo', 'started', 'submitted', 'graded')),
  source text not null check (source in (
    'manual', 'seed', 'learn_ics', 'cs251_schedule', 'cs251_examinfo', 'cs251_assignments', 'open_data',
    'paste', 'piazza_email', 'crowdmark_email', 'note', 'page_diff')),
  source_ref text not null default gen_random_uuid()::text,
  source_url text,
  source_document_id uuid references public.documents (id) on delete set null,
  source_missing_at timestamptz,               -- set when a synced source stops listing this item
  last_change_source text,                     -- set by the app on update; copied into item_changes
  locked_fields text[] not null default '{}',  -- fields Dylan edited by hand; syncs propose instead of overwriting
  prep_days int,                               -- overrides the reminder rule's runway
  reminder_minutes int[],                      -- overrides the rule's reminders (max 5 values, max 40320)
  gcal_event_id text,
  gcal_prep_event_ids text[] not null default '{}',
  gcal_synced_hash text,
  gcal_synced_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (
    to_tsvector('english',
      coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(location, ''))
  ) stored,
  unique (user_id, source, source_ref),
  check (reminder_minutes is null or cardinality(reminder_minutes) <= 5)
);

create table public.item_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  field text not null,
  old_value text,
  new_value text,
  source text,
  detected_at timestamptz not null default now()
);

create or replace function public.log_item_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  f text;
  old_val text;
  new_val text;
begin
  foreach f in array array[
    'title', 'kind', 'starts_at', 'due_at', 'ends_at', 'all_day', 'location', 'seat',
    'weight_percent', 'flags', 'state', 'progress', 'source_missing_at']
  loop
    execute format('select ($1).%I::text, ($2).%I::text', f, f)
      into old_val, new_val
      using old, new;
    if old_val is distinct from new_val then
      insert into public.item_changes (user_id, item_id, field, old_value, new_value, source)
      values (new.user_id, new.id, f, old_val, new_val, coalesce(new.last_change_source, 'unknown'));
    end if;
  end loop;
  return new;
end;
$$;

create trigger items_log_changes
after update on public.items
for each row execute function public.log_item_changes();

-- ---------------------------------------------------------------------------
-- Notes: the original paste is kept byte for byte; Claude's copy sits beside it
-- ---------------------------------------------------------------------------

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id uuid references public.courses (id) on delete set null,
  lecture_on date,
  title text,
  original_md text not null,                   -- never changes (trigger below)
  cleaned_md text,                             -- latest Claude cleanup
  edited_md text,                              -- Dylan's edits to the cleaned copy
  cleanup_status text not null default 'pending' check (cleanup_status in ('pending', 'running', 'done', 'failed')),
  cleanup_model text,
  cleanup_instruction text,
  cleanup_error text,
  cleaned_at timestamptz,
  topics text[] not null default '{}',
  summary text,
  open_questions text[] not null default '{}',
  content_hash text not null,                  -- sha256 of original_md
  search tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, content_hash)
);

create or replace function public.protect_note_original()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.original_md is distinct from old.original_md or new.content_hash is distinct from old.content_hash then
    raise exception 'notes.original_md is immutable';
  end if;
  return new;
end;
$$;

create trigger notes_protect_original
before update on public.notes
for each row execute function public.protect_note_original();

create or replace function public.notes_search_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.search :=
    setweight(to_tsvector('english', coalesce(new.title, '')), 'A') ||
    setweight(to_tsvector('english', array_to_string(new.topics, ' ')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.summary, '')), 'B') ||
    setweight(to_tsvector('english', left(coalesce(new.edited_md, new.cleaned_md, ''), 400000)), 'C') ||
    setweight(to_tsvector('english', left(new.original_md, 400000)), 'D');
  return new;
end;
$$;

create trigger notes_search
before insert or update on public.notes
for each row execute function public.notes_search_update();

-- ---------------------------------------------------------------------------
-- Chunks: retrieval units for Ask (notes and documents)
-- ---------------------------------------------------------------------------

create table public.chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id uuid references public.courses (id) on delete set null,
  parent_type text not null check (parent_type in ('note', 'document')),
  parent_id uuid not null,
  ord int not null,
  heading text,
  content text not null,
  token_estimate int not null default 0,
  created_at timestamptz not null default now(),
  search tsvector generated always as (
    to_tsvector('english', coalesce(heading, '') || ' ' || content)
  ) stored,
  unique (parent_type, parent_id, ord)
);

create or replace function public.delete_chunks_for_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  delete from public.chunks where parent_type = tg_argv[0] and parent_id = old.id;
  return old;
end;
$$;

create trigger notes_delete_chunks
after delete on public.notes
for each row execute function public.delete_chunks_for_parent('note');

create trigger documents_delete_chunks
after delete on public.documents
for each row execute function public.delete_chunks_for_parent('document');

-- ---------------------------------------------------------------------------
-- Review queue: anything an LLM extracted waits here for approval
-- ---------------------------------------------------------------------------

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id uuid references public.courses (id) on delete set null,
  source_document_id uuid references public.documents (id) on delete cascade,
  source_note_id uuid references public.notes (id) on delete cascade,
  kind text not null check (kind in (
    'create_item', 'update_item', 'course_info', 'link', 'meeting', 'grade', 'other')),
  target_item_id uuid references public.items (id) on delete cascade,
  payload jsonb not null,
  evidence text,                               -- exact quote from the source
  confidence real,
  state text not null default 'pending' check (state in ('pending', 'approved', 'dismissed', 'superseded')),
  decided_at timestamptz,
  applied_item_id uuid references public.items (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.grades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  item_id uuid references public.items (id) on delete set null,
  label text not null,
  score numeric,
  out_of numeric,
  weight_percent numeric(5, 2),
  source text not null default 'paste',
  source_document_id uuid references public.documents (id) on delete set null,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Reminders that aren't deadlines: paste this, check that, weekly sweep
-- ---------------------------------------------------------------------------

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id uuid references public.courses (id) on delete cascade,
  item_id uuid references public.items (id) on delete cascade,
  kind text not null check (kind in ('paste', 'check', 'sweep', 'custom')),
  paste_kind text,                             -- catalog key from docs/SOURCES.md
  dedupe_key text not null,
  title text not null,
  where_to_find text,
  url text,
  remind_at timestamptz not null,
  done_at timestamptz,
  snoozed_until timestamptz,
  gcal_event_id text,
  gcal_synced_hash text,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

-- ---------------------------------------------------------------------------
-- Sync bookkeeping
-- ---------------------------------------------------------------------------

create table public.watched_pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id uuid references public.courses (id) on delete cascade,
  url text not null,
  label text not null,
  parser text not null default 'diff' check (parser in ('diff', 'cs251_schedule', 'cs251_examinfo', 'cs251_assignments')),
  cadence text not null default 'daily' check (cadence in ('hourly', 'every_3h', 'daily')),
  enabled boolean not null default true,
  etag text,
  last_modified text,
  last_hash text,
  last_checked_at timestamptz,
  last_changed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (user_id, url)
);

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  stats jsonb not null default '{}',
  error text
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  attempts int not null default 0,
  max_attempts int not null default 3,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  dedupe_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index jobs_dedupe
  on public.jobs (user_id, dedupe_key)
  where dedupe_key is not null and status in ('pending', 'running');

create index jobs_ready on public.jobs (run_after) where status = 'pending';

-- Claim up to p_limit ready jobs. Safe to call from overlapping workers.
create or replace function public.claim_jobs(p_limit int default 5)
returns setof public.jobs
language sql
set search_path = ''
as $$
  update public.jobs j
  set status = 'running', locked_at = now(), attempts = j.attempts + 1, updated_at = now()
  where j.id in (
    select id from public.jobs
    where status = 'pending' and run_after <= now()
    order by run_after
    limit p_limit
    for update skip locked
  )
  returning j.*;
$$;

-- Put jobs that died mid-run back in the queue (or fail them after max_attempts).
create or replace function public.requeue_stale_jobs(p_stale interval default interval '5 minutes')
returns int
language plpgsql
set search_path = ''
as $$
declare
  n int;
begin
  update public.jobs
  set status = case when attempts >= max_attempts then 'failed' else 'pending' end,
      last_error = coalesce(last_error, 'worker timed out'),
      locked_at = null,
      run_after = now() + interval '1 minute',
      updated_at = now()
  where status = 'running' and locked_at < now() - p_stale;
  get diagnostics n = row_count;
  return n;
end;
$$;

create table public.ai_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  purpose text not null,                       -- classify, extract_outline, cleanup, note_meta, ask, ...
  model text not null,
  input_tokens int,
  output_tokens int,
  cache_read_tokens int,
  cache_write_tokens int,
  cost_usd numeric(10, 4),
  duration_ms int,
  ok boolean not null default true,
  error text,
  request_ref text,                            -- document, note, or thread id
  raw_output jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Ask
-- ---------------------------------------------------------------------------

create table public.ask_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id uuid references public.courses (id) on delete set null,
  scope jsonb not null default '{"type": "all"}',
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ask_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  thread_id uuid not null references public.ask_threads (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  citations jsonb not null default '[]',       -- [{chunk_id, parent_type, parent_id, title, cited_text}]
  model text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Integrations and settings
-- ---------------------------------------------------------------------------

create table public.integration_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft', 'learn_ics')),
  secret_ciphertext text not null,             -- AES-256-GCM with TOKEN_ENCRYPTION_KEY
  scopes text[] not null default '{}',
  meta jsonb not null default '{}',            -- calendar_id, account email, expires_at
  status text not null default 'ok' check (status in ('ok', 'reauth_required', 'error')),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create table public.settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  timezone text not null default 'America/Toronto',
  digest_hour int not null default 8 check (digest_hour between 0 and 23),
  study_block_hour int not null default 19 check (study_block_hour between 0 and 23),
  reminder_rules jsonb not null default '{}',  -- overrides of src/lib/reminders/rules.ts
  note_style_prompt text,
  answer_style_prompt text,
  ask_context_budget int not null default 80000,
  piazza_map jsonb not null default '{}',      -- {nid: course_slug}
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['courses', 'items', 'notes', 'jobs', 'ask_threads', 'integration_tokens', 'settings']
  loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_updated_at', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index items_due on public.items (user_id, due_at) where state = 'active';
create index items_starts on public.items (user_id, starts_at) where state = 'active';
create index items_course on public.items (course_id, due_at);
create index items_search on public.items using gin (search);
create index items_title_trgm on public.items using gin (title extensions.gin_trgm_ops);
create index item_changes_item on public.item_changes (item_id, detected_at desc);
create index item_changes_recent on public.item_changes (user_id, detected_at desc);
create index documents_search on public.documents using gin (search);
create index documents_course on public.documents (course_id, captured_at desc);
create index documents_kind on public.documents (user_id, kind, captured_at desc);
create index notes_search on public.notes using gin (search);
create index notes_course on public.notes (course_id, lecture_on desc);
create index chunks_search on public.chunks using gin (search);
create index chunks_parent on public.chunks (parent_type, parent_id);
create index chunks_course on public.chunks (course_id);
create index links_label_trgm on public.links using gin (label extensions.gin_trgm_ops);
create index proposals_pending on public.proposals (user_id, created_at desc) where state = 'pending';
create index reminders_open on public.reminders (user_id, remind_at) where done_at is null;
create index sync_runs_source on public.sync_runs (user_id, source, started_at desc);
create index ai_calls_month on public.ai_calls (user_id, created_at);
create index ask_messages_thread on public.ask_messages (thread_id, created_at);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'terms', 'courses', 'links', 'documents', 'items', 'item_changes', 'notes', 'chunks',
    'proposals', 'grades', 'reminders', 'watched_pages', 'sync_runs', 'ai_calls',
    'ask_threads', 'ask_messages', 'settings']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      'using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t || '_owner', t);
  end loop;

  -- Server-only tables: RLS on with no policies, so only the service role can touch them.
  foreach t in array array['jobs', 'integration_tokens']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Search
-- ---------------------------------------------------------------------------

-- Global search for the command palette and /search.
-- The app expands aliases first ("251" -> p_course_id, "a3" -> "A3").
create or replace function public.search_all(q text, p_course_id uuid default null, p_limit int default 30)
returns table (
  result_type text,
  result_id uuid,
  course_id uuid,
  title text,
  snippet text,
  happened_at timestamptz,
  rank real
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with query as (
    select websearch_to_tsquery('english', q) as tsq
  )
  select * from (
    select 'item'::text, i.id, i.course_id, i.title,
           coalesce(i.location, left(coalesce(i.description, ''), 160))::text,
           coalesce(i.due_at, i.starts_at),
           greatest(ts_rank(i.search, query.tsq), word_similarity(q, i.title))::real
    from items i, query
    where i.state = 'active'
      and (p_course_id is null or i.course_id = p_course_id)
      and (i.search @@ query.tsq or q <% i.title)

    union all

    select 'note'::text, n.id, n.course_id, coalesce(n.title, 'Untitled note'),
           ts_headline('english', left(coalesce(n.edited_md, n.cleaned_md, n.original_md), 20000),
                       query.tsq, 'MaxFragments=1, MaxWords=24, MinWords=8'),
           n.lecture_on::timestamptz,
           ts_rank(n.search, query.tsq)::real
    from notes n, query
    where (p_course_id is null or n.course_id = p_course_id)
      and n.search @@ query.tsq

    union all

    select 'document'::text, d.id, d.course_id, d.title,
           ts_headline('english', left(d.raw_text, 20000), query.tsq,
                       'MaxFragments=1, MaxWords=24, MinWords=8'),
           d.captured_at,
           ts_rank(d.search, query.tsq)::real
    from documents d, query
    where (p_course_id is null or d.course_id = p_course_id)
      and d.search @@ query.tsq

    union all

    select 'link'::text, l.id, l.course_id, l.label, l.url, l.created_at,
           greatest(word_similarity(q, l.label),
                    case when l.url ilike '%' || q || '%' then 0.5 else 0 end)::real
    from links l
    where (p_course_id is null or l.course_id = p_course_id)
      and (q <% l.label or l.url ilike '%' || q || '%')
  ) results (result_type, result_id, course_id, title, snippet, happened_at, rank)
  order by rank desc, happened_at desc nulls last
  limit p_limit;
$$;

-- Retrieval for Ask. OR-matches the question's terms and ranks by cover density.
create or replace function public.search_chunks(q text, p_course_id uuid default null, p_limit int default 20)
returns table (
  chunk_id uuid,
  parent_type text,
  parent_id uuid,
  course_id uuid,
  heading text,
  content text,
  rank real
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with query as (
    select nullif(replace(plainto_tsquery('english', q)::text, '&', '|'), '')::tsquery as tsq
  )
  select c.id, c.parent_type, c.parent_id, c.course_id, c.heading, c.content,
         ts_rank_cd(c.search, query.tsq)::real as rank
  from chunks c, query
  where query.tsq is not null
    and (p_course_id is null or c.course_id = p_course_id)
    and c.search @@ query.tsq
  order by rank desc
  limit p_limit;
$$;

-- Queue functions are for the service role only.
revoke execute on function public.claim_jobs(int) from public, anon, authenticated;
revoke execute on function public.requeue_stale_jobs(interval) from public, anon, authenticated;
