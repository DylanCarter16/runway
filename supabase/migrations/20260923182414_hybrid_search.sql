-- Phase 8: hybrid search for Ask. Each chunk from a course with AI on can carry a
-- Voyage AI embedding (voyage-4, 1024 dimensions, the model's default size).
-- Ask ranks passages by full-text search and by vector similarity and merges the
-- two lists. Off until Dylan turns it on in Settings, AI.

create extension if not exists vector with schema extensions;

alter table public.chunks
  add column embedding extensions.vector(1024),
  add column embedding_model text;

create index chunks_embedding on public.chunks
  using hnsw (embedding extensions.vector_cosine_ops);

alter table public.settings
  add column ask_hybrid_search boolean not null default false;

-- Nearest chunks to a question's embedding, by cosine similarity (1 is identical).
-- security invoker, so RLS limits it to the caller's own chunks.
create or replace function public.match_chunks(
  query_embedding extensions.vector(1024),
  p_course_id uuid default null,
  p_limit int default 20
)
returns table (
  chunk_id uuid,
  parent_type text,
  parent_id uuid,
  course_id uuid,
  heading text,
  content text,
  similarity real
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select c.id, c.parent_type, c.parent_id, c.course_id, c.heading, c.content,
         (1 - (c.embedding <=> query_embedding))::real as similarity
  from chunks c
  where c.embedding is not null
    and (p_course_id is null or c.course_id = p_course_id)
  order by c.embedding <=> query_embedding
  limit p_limit;
$$;

-- New chunks (and chunks that move to another course) queue the embedding job,
-- but only while hybrid search is on. The job itself skips courses with AI off.
-- The job's own writes only touch embedding columns, so they never re-queue it.
create or replace function public.queue_chunk_embeddings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.embedding is not null then
    return null;
  end if;
  if not exists (
    select 1 from public.settings s where s.user_id = new.user_id and s.ask_hybrid_search
  ) then
    return null;
  end if;
  insert into public.jobs (user_id, type, dedupe_key, run_after)
  values (new.user_id, 'embeddings.chunks', 'embeddings:chunks', now() + interval '10 seconds')
  on conflict (user_id, dedupe_key) where dedupe_key is not null and status in ('pending', 'running')
  do nothing;
  return null;
end;
$$;

revoke execute on function public.queue_chunk_embeddings() from public, anon, authenticated;

drop trigger if exists chunks_queue_embeddings on public.chunks;
create trigger chunks_queue_embeddings
  after insert or update of course_id on public.chunks
  for each row execute function public.queue_chunk_embeddings();
