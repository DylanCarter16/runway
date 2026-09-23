-- Deleting a user cascades to their items and reminders. queue_calendar_work() then
-- tried to queue a job for that user, which fails the jobs.user_id foreign key
-- ("Database error deleting user") whenever no job with the same dedupe key was
-- already pending. Skip queueing when the row's user no longer exists.

create or replace function public.queue_calendar_work()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_user uuid;
  job_type text;
  job_key text;
  ignored text[] := array[
    'gcal_event_id', 'gcal_prep_event_ids', 'gcal_synced_hash', 'gcal_synced_at', 'updated_at', 'search'];
begin
  if tg_op = 'UPDATE' and (to_jsonb(new) - ignored) = (to_jsonb(old) - ignored) then
    return null;
  end if;
  row_user := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  if tg_op = 'DELETE' and not exists (select 1 from auth.users u where u.id = row_user) then
    return null;
  end if;

  if tg_table_name = 'items' then
    job_type := 'reminders.generate';
    job_key := 'reminders:generate';
  else
    if not exists (
      select 1 from public.integration_tokens t
      where t.user_id = row_user and t.provider = 'google' and t.status = 'ok'
    ) then
      return null;
    end if;
    job_type := 'gcal.sync';
    job_key := 'gcal:sync';
  end if;

  insert into public.jobs (user_id, type, dedupe_key, run_after)
  values (row_user, job_type, job_key, now() + interval '10 seconds')
  on conflict (user_id, dedupe_key) where dedupe_key is not null and status in ('pending', 'running')
  do nothing;
  return null;
end;
$$;

revoke execute on function public.queue_calendar_work() from public, anon, authenticated;
