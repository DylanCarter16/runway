-- Storage egress guard (2026-10-20). Every read of a stored library file is counted per
-- document, per reader, per Toronto day: the viewer asking for a file link, "Open the
-- original", the job worker downloading a file, and the data export. Settings, Data shows
-- the counts, and the worker refuses to download a file past its daily cap
-- (src/lib/files/storage-reads.ts), so a refetch loop shows up and stops instead of
-- quietly using the month's egress.

create table public.storage_reads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  via text not null check (via in ('viewer', 'original', 'worker', 'export')),
  day date not null,
  reads int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, via, day)
);

create index storage_reads_user_day on public.storage_reads (user_id, day desc);

create trigger storage_reads_updated_at before update on public.storage_reads
  for each row execute function public.set_updated_at();

alter table public.storage_reads enable row level security;
create policy storage_reads_owner on public.storage_reads for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Counts one read and returns the document's reads by that reader today. Security invoker:
-- a signed-in user can only count their own documents (RLS on documents and on this
-- table); the service role (worker, export) can count any. Returns null for an unknown document.
create or replace function public.record_storage_read(p_document_id uuid, p_via text)
returns int
language sql
security invoker
set search_path = ''
as $$
  insert into public.storage_reads as s (user_id, document_id, via, day, reads)
  select d.user_id, d.id, p_via, (now() at time zone 'America/Toronto')::date, 1
  from public.documents d
  where d.id = p_document_id
  on conflict (document_id, via, day)
  do update set reads = s.reads + 1
  returning reads;
$$;

revoke execute on function public.record_storage_read(uuid, text) from public, anon;
grant execute on function public.record_storage_read(uuid, text) to authenticated, service_role;
