-- Phase 10: document library. Every PDF page is searchable on its own, with the outline
-- headings that point at a page weighted above its body text. No AI anywhere in this path:
-- the text comes from the PDF's own text layer (unpdf) and the headings from its bookmarks
-- or from numbered headings found in that text.

-- ---------------------------------------------------------------------------
-- document_pages: headings and a weighted search vector
-- ---------------------------------------------------------------------------

alter table public.document_pages
  add column headings text;       -- outline titles that open on this page, one per line

alter table public.document_pages
  add column search tsvector generated always as (
    setweight(to_tsvector('english', coalesce(headings, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(text, '')), 'B')
  ) stored;

create index document_pages_search on public.document_pages using gin (search);

-- ---------------------------------------------------------------------------
-- search_pages: page-level search inside one document, one course, or every file.
-- Security invoker, so RLS on document_pages and documents keeps it to the owner.
-- Snippets mark matches with <mark>…</mark>; the app renders them as text, never as HTML.
-- ---------------------------------------------------------------------------

create or replace function public.search_pages(
  q text,
  p_document_id uuid default null,
  p_course_id uuid default null,
  p_limit int default 50
)
returns table (
  document_id uuid,
  course_id uuid,
  title text,
  page int,
  heading text,
  snippet text,
  rank real
)
language sql
stable
security invoker
set search_path = public
as $$
  with query as (
    select websearch_to_tsquery('english', q) as tsq
  )
  select p.document_id, d.course_id, d.title, p.page,
         nullif(split_part(coalesce(p.headings, ''), E'\n', 1), ''),
         ts_headline('english', left(coalesce(p.text, ''), 20000), query.tsq,
                     'MaxFragments=1, MaxWords=24, MinWords=8, StartSel=<mark>, StopSel=</mark>'),
         ts_rank(p.search, query.tsq)::real
  from document_pages p
  join documents d on d.id = p.document_id,
       query
  where p.search @@ query.tsq
    and p.status in ('done', 'already_stored')
    and d.kind in ('upload', 'textbook')
    and (p_document_id is null or p.document_id = p_document_id)
    and (p_course_id is null or d.course_id = p_course_id)
  order by ts_rank(p.search, query.tsq) desc, d.title, p.page
  limit least(greatest(p_limit, 1), 200);
$$;

-- ---------------------------------------------------------------------------
-- search_all: uploaded files now match by page (best page per file), and say which page.
-- Files added from the note form stay out; their new material is already in a note.
-- The return type gains `page`, so the function is dropped and made again.
-- ---------------------------------------------------------------------------

drop function public.search_all(text, uuid, int);

create function public.search_all(q text, p_course_id uuid default null, p_limit int default 30)
returns table (
  result_type text,
  result_id uuid,
  course_id uuid,
  title text,
  snippet text,
  happened_at timestamptz,
  rank real,
  page int
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
           greatest(ts_rank(i.search, query.tsq), word_similarity(q, i.title))::real,
           null::int
    from items i, query
    where i.state = 'active'
      and (p_course_id is null or i.course_id = p_course_id)
      and (i.search @@ query.tsq or q <% i.title)

    union all

    select 'note'::text, n.id, n.course_id, coalesce(n.title, 'Untitled note'),
           ts_headline('english', left(coalesce(n.edited_md, n.cleaned_md, n.original_md), 20000),
                       query.tsq, 'MaxFragments=1, MaxWords=24, MinWords=8'),
           n.lecture_on::timestamptz,
           ts_rank(n.search, query.tsq)::real,
           null::int
    from notes n, query
    where (p_course_id is null or n.course_id = p_course_id)
      and n.search @@ query.tsq

    union all

    select 'document'::text, d.id, d.course_id, d.title,
           ts_headline('english', left(d.raw_text, 20000), query.tsq,
                       'MaxFragments=1, MaxWords=24, MinWords=8'),
           d.captured_at,
           ts_rank(d.search, query.tsq)::real,
           null::int
    from documents d, query
    where (p_course_id is null or d.course_id = p_course_id)
      and d.kind <> 'note_source'
      and d.search @@ query.tsq

    union all

    select * from (
      select distinct on (d.id)
             'page'::text, d.id, d.course_id, d.title,
             ts_headline('english', left(coalesce(p.text, ''), 20000), query.tsq,
                         'MaxFragments=1, MaxWords=24, MinWords=8'),
             d.captured_at,
             ts_rank(p.search, query.tsq)::real,
             p.page
      from documents d
      join document_pages p on p.document_id = d.id,
           query
      where (p_course_id is null or d.course_id = p_course_id)
        and d.kind in ('upload', 'textbook')
        and coalesce(d.meta ->> 'purpose', '') <> 'note'
        and p.status in ('done', 'already_stored')
        and p.search @@ query.tsq
      order by d.id, ts_rank(p.search, query.tsq) desc, p.page
    ) page_hits

    union all

    select 'link'::text, l.id, l.course_id, l.label, l.url, l.created_at,
           greatest(word_similarity(q, l.label),
                    case when l.url ilike '%' || q || '%' then 0.5 else 0 end)::real,
           null::int
    from links l
    where (p_course_id is null or l.course_id = p_course_id)
      and (q <% l.label or l.url ilike '%' || q || '%')
  ) results (result_type, result_id, course_id, title, snippet, happened_at, rank, page)
  order by rank desc, happened_at desc nulls last
  limit p_limit;
$$;
