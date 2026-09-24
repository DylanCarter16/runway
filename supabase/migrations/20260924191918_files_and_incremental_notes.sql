-- Phase 9: files anywhere (uploads, page transcription, textbooks) and incremental notes.

-- ---------------------------------------------------------------------------
-- Library bucket: private, one folder per user (<user_id>/...). Originals are never altered,
-- so there is no update policy; the browser uploads straight into its own folder.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'library', 'library', false, 52428800,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy library_owner_select on storage.objects for select to authenticated
  using (bucket_id = 'library' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy library_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'library' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy library_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'library' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- Documents: uploaded files, textbooks, and the full running-notes paste
-- ---------------------------------------------------------------------------

alter table public.documents drop constraint documents_kind_check;
alter table public.documents add constraint documents_kind_check check (kind in (
  'outline', 'announcement', 'piazza_email', 'piazza_resources', 'crowdmark_email',
  'crowdmark_assessment', 'page_snapshot', 'assignment_pdf', 'assignment_header',
  'quest_schedule', 'odyssey_paste', 'grade_paste', 'resource', 'other',
  'upload',        -- a PDF, image, or screenshot; the original is in storage_path
  'textbook',      -- a stored book: listed, transcribed only for the page ranges asked for
  'note_source')); -- the whole running-notes paste a note was cut from

-- File facts, kept exactly as uploaded. For files, content_hash is the sha256 of the bytes
-- and raw_text is empty; the text lives in document_pages.
alter table public.documents
  add column file_name text,
  add column file_size bigint check (file_size is null or file_size >= 0),
  add column file_type text;

-- ---------------------------------------------------------------------------
-- document_pages: one row per page (an image is page 1). Tracks what was read, how, and
-- why a page was skipped, so long files resume across job steps and repeat pages are skipped.
-- ---------------------------------------------------------------------------

create table public.document_pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  document_id uuid not null references public.documents (id) on delete cascade,
  page int not null check (page >= 1),
  status text not null default 'pending'
    check (status in ('pending', 'done', 'skipped', 'failed', 'already_stored', 'not_requested')),
  method text check (method in ('pdf_text', 'vision')),
  text text,
  reason text,                    -- shown to Dylan when a page is skipped or failed
  fingerprint text,               -- sha256 of the page's content, to spot pages already stored
  same_as uuid references public.document_pages (id) on delete set null,
  unique (document_id, page)
);

create index document_pages_fingerprint on public.document_pages (user_id, fingerprint);

alter table public.document_pages enable row level security;
create policy document_pages_owner on public.document_pages for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create trigger document_pages_updated_at before update on public.document_pages
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Notes cut from a running document: the full paste is a note_source document, the note
-- holds only the new material, and `incremental` records what was decided (for undo).
-- ---------------------------------------------------------------------------

alter table public.notes
  add column source_document_id uuid references public.documents (id) on delete set null,
  add column incremental jsonb;

create index notes_source_document on public.notes (source_document_id);

-- ---------------------------------------------------------------------------
-- Search: uploaded files match through their chunks (their text isn't in raw_text).
-- The running-notes paste is left out; its new material is already in a note.
-- ---------------------------------------------------------------------------

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
      and d.kind <> 'note_source'
      and d.search @@ query.tsq

    union all

    select * from (
      select distinct on (d.id)
             'document'::text, d.id, d.course_id, d.title,
             ts_headline('english', c.content, query.tsq, 'MaxFragments=1, MaxWords=24, MinWords=8'),
             d.captured_at,
             ts_rank(c.search, query.tsq)::real
      from documents d
      join chunks c on c.parent_type = 'document' and c.parent_id = d.id,
           query
      where (p_course_id is null or d.course_id = p_course_id)
        and d.kind in ('upload', 'textbook')
        and c.search @@ query.tsq
        and not d.search @@ query.tsq
      order by d.id, ts_rank(c.search, query.tsq) desc
    ) file_hits

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
