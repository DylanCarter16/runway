-- The hosted project got an earlier draft of the init migration (applied by hand, then
-- marked as applied with `supabase migration repair`). This brings it in line with
-- 20260915000000_init.sql. Every statement is a no-op on a database built from that file.

alter table public.courses add column if not exists ai_allowed boolean not null default false;
alter table public.items add column if not exists flags text[] not null default '{}';

alter table public.items drop constraint if exists items_source_check;
alter table public.items add constraint items_source_check check (source in (
  'manual', 'seed', 'learn_ics', 'cs251_schedule', 'cs251_examinfo', 'cs251_assignments', 'open_data',
  'paste', 'piazza_email', 'crowdmark_email', 'note', 'page_diff'));

alter table public.watched_pages drop constraint if exists watched_pages_parser_check;
alter table public.watched_pages add constraint watched_pages_parser_check check (parser in (
  'diff', 'cs251_schedule', 'cs251_examinfo', 'cs251_assignments'));

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
