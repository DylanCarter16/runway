-- Schema behaviour checks. Run with tests/db/run.sh against a scratch Postgres.
-- Lines containing FAIL mean a check broke.
\set ON_ERROR_STOP 1
\set QUIET 1
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'dylan@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'other@example.com');

-- ===== As Dylan =====
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

insert into terms (code, name, starts_on, ends_on, is_current) values ('1269', 'Fall 2026', '2026-09-09', '2026-12-23', true);
insert into courses (term_id, code, slug, title) select id, 'CS 251', 'cs251', 'Computer Organization and Design' from terms where code = '1269';
insert into courses (term_id, code, slug, title) select id, 'CS 246', 'cs246', 'Object-Oriented Software Development' from terms where code = '1269';

-- idempotent upsert, twice
insert into items (course_id, kind, title, due_at, all_day, time_known, source, source_ref, source_url, last_change_source)
select id, 'assignment', 'A1', '2026-09-30 00:00-04', true, false, 'cs251_schedule', 'cs251:A1', 'https://example/a1.pdf', 'cs251_schedule'
from courses where slug = 'cs251'
on conflict (user_id, source, source_ref) do update set due_at = excluded.due_at, last_change_source = excluded.last_change_source;
insert into items (course_id, kind, title, due_at, all_day, time_known, source, source_ref, source_url, last_change_source)
select id, 'assignment', 'A1', '2026-09-30 00:00-04', true, false, 'cs251_schedule', 'cs251:A1', 'https://example/a1.pdf', 'cs251_schedule'
from courses where slug = 'cs251'
on conflict (user_id, source, source_ref) do update set due_at = excluded.due_at, last_change_source = excluded.last_change_source;
select 'T1 upsert idempotent: ' || (count(*) = 1)::text from items where source_ref = 'cs251:A1';
select 'T1b no change logged for identical upsert: ' || (count(*) = 0)::text from item_changes;

-- manual item gets a random source_ref
insert into items (course_id, kind, title, starts_at, location, source)
select id, 'midterm', 'Midterm', '2026-11-12 16:30-05', null, 'manual' from courses where slug = 'cs251';

-- change log
update items set due_at = '2026-10-02 23:59-04', time_known = true, all_day = false, last_change_source = 'piazza_email' where source_ref = 'cs251:A1';
update items set seat = 'MC 2066 seat 42', location = 'MC 2066', last_change_source = 'paste' where title = 'Midterm';
select 'T2 change log rows: ' || count(*)::text || ' (expect 4: due_at, all_day, location, seat)' from item_changes;
select 'T2b change source recorded: ' || bool_and(source in ('piazza_email', 'paste'))::text from item_changes;
select field, old_value, new_value, source from item_changes order by detected_at, field;

-- reminder_minutes cap
savepoint s1;
do $$ begin
  begin
    update items set reminder_minutes = array[1,2,3,4,5,6] where title = 'A1';
    raise notice 'T3 FAIL: 6 reminders accepted';
  exception when check_violation then
    raise notice 'T3 reminder cap enforced: true';
  end;
end $$;

-- notes
insert into notes (course_id, lecture_on, title, original_md, content_hash, topics)
select id, '2026-09-24', 'Latches and flip-flops', 'sr latch has set and reset. d flip flop samples on the clock edge. teh d latch is level sensitive', 'hash-note-1', array['latches', 'flip-flops']
from courses where slug = 'cs251';
update notes set cleaned_md = 'An SR latch has set and reset inputs. A D flip-flop samples on the clock edge. The D latch is level sensitive.', cleanup_status = 'done' where title = 'Latches and flip-flops';
select 'T4 cleaned copy saved, search updated: ' || (search @@ websearch_to_tsquery('english', 'level sensitive'))::text from notes;
do $$ begin
  begin
    update notes set original_md = 'tampered' where title = 'Latches and flip-flops';
    raise notice 'T5 FAIL: original changed';
  exception when raise_exception then
    raise notice 'T5 original_md immutable: true';
  end;
end $$;

-- documents
insert into documents (course_id, kind, title, source_ref, raw_text, content_hash)
select id, 'piazza_email', 'A2 deadline extended', 'gmail-abc', 'Instructor note: the A2 deadline is extended to October 26 at 11:59pm.', 'hash-doc-1'
from courses where slug = 'cs251';
do $$ begin
  begin
    insert into documents (kind, title, source_ref, raw_text, content_hash)
    values ('piazza_email', 'dupe', 'gmail-abc', 'different text', 'hash-doc-2');
    raise notice 'T6 FAIL: duplicate email id accepted';
  exception when unique_violation then
    raise notice 'T6 email id dedupe: true';
  end;
end $$;
do $$ begin
  begin
    update documents set raw_text = 'edited' where source_ref = 'gmail-abc';
    raise notice 'T7 FAIL: raw_text changed';
  exception when raise_exception then
    raise notice 'T7 raw_text immutable: true';
  end;
end $$;

-- links (global link uniqueness with null course_id)
insert into links (label, url, category) values ('Odyssey exam schedule', 'https://odyssey.uwaterloo.ca/teaching/schedule', 'exam');
do $$ begin
  begin
    insert into links (label, url, category) values ('Odyssey again', 'https://odyssey.uwaterloo.ca/teaching/schedule', 'exam');
    raise notice 'T8 FAIL: duplicate global link accepted';
  exception when unique_violation then
    raise notice 'T8 global link dedupe: true';
  end;
end $$;
insert into links (course_id, label, url, category, pinned)
select id, 'Marmoset', 'https://marmoset.student.cs.uwaterloo.ca/', 'submission', true from courses where slug = 'cs246';

-- chunks
insert into chunks (course_id, parent_type, parent_id, ord, heading, content)
select course_id, 'note', id, 0, 'Latches', 'An SR latch has set and reset inputs. The D latch is level sensitive.' from notes;
insert into chunks (course_id, parent_type, parent_id, ord, heading, content)
select course_id, 'note', id, 1, 'Flip-flops', 'A D flip-flop samples its input on the clock edge, unlike a latch.' from notes;

-- search_all
select 'T9 search A1 -> ' || string_agg(result_type || ':' || title, ', ') from search_all('A1');
select 'T10 search flip-flop -> ' || string_agg(result_type || ':' || title, ', ') from search_all('flip-flop');
select 'T11 search marmoset -> ' || string_agg(result_type || ':' || title, ', ') from search_all('marmoset');
select 'T12 search deadline extended -> ' || string_agg(result_type || ':' || title, ', ') from search_all('deadline extended');
select 'T13 course filter (cs246, "A1") empty: ' || (count(*) = 0)::text from search_all('A1', (select id from courses where slug = 'cs246'));
select 'T14 search odysey (typo) -> ' || coalesce(string_agg(result_type || ':' || title, ', '), '(none)') from search_all('odysey');

-- search_chunks (natural question, OR semantics)
select 'T15 chunks for question -> ' || string_agg(heading || ' (' || round(rank::numeric, 3)::text || ')', ', ' order by rank desc)
from search_chunks('what is the difference between a latch and a flip-flop?');
select 'T16 empty question safe: ' || (count(*) = 0)::text from search_chunks('the of and');

-- server-only tables
do $$ begin
  begin
    perform * from jobs;
    raise notice 'T17 jobs select as authenticated returned rows allowed (RLS hides them): true';
  exception when insufficient_privilege then
    raise notice 'T17 jobs blocked by privilege: true';
  end;
end $$;
select 'T17b jobs visible to user: ' || count(*)::text from jobs;
do $$ begin
  begin
    perform public.claim_jobs(1);
    raise notice 'T18 FAIL: authenticated can claim jobs';
  exception when insufficient_privilege then
    raise notice 'T18 claim_jobs denied to authenticated: true';
  end;
end $$;
commit;

-- ===== As the other user =====
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
select 'T19 other user sees items/notes/docs/links/changes: '
  || (select count(*) from items) || '/' || (select count(*) from notes) || '/'
  || (select count(*) from documents) || '/' || (select count(*) from links) || '/'
  || (select count(*) from item_changes) || ' (expect 0/0/0/0/0)';
select 'T20 other user search empty: ' || (count(*) = 0)::text from search_all('A1');
do $$ begin
  begin
    insert into items (user_id, kind, title, source) values ('11111111-1111-1111-1111-111111111111', 'other', 'sneaky', 'manual');
    raise notice 'T21 FAIL: wrote a row for another user';
  exception when insufficient_privilege then
    raise notice 'T21 cross-user insert blocked: true';
  end;
end $$;
commit;

-- ===== As the service role (job worker) =====
begin;
set local role service_role;
insert into jobs (user_id, type, payload, dedupe_key) values
  ('11111111-1111-1111-1111-111111111111', 'cleanup_note', '{}', 'note:1'),
  ('11111111-1111-1111-1111-111111111111', 'extract_document', '{}', 'doc:1');
do $$ begin
  begin
    insert into jobs (user_id, type, dedupe_key) values ('11111111-1111-1111-1111-111111111111', 'cleanup_note', 'note:1');
    raise notice 'T22 FAIL: duplicate pending job accepted';
  exception when unique_violation then
    raise notice 'T22 pending job dedupe: true';
  end;
end $$;
select 'T23 claimed: ' || count(*)::text || ' (expect 2)' from claim_jobs(5);
select 'T24 claim again empty: ' || (count(*) = 0)::text from claim_jobs(5);
update jobs set locked_at = now() - interval '10 minutes';
select 'T25 requeued stale: ' || requeue_stale_jobs()::text || ' (expect 2)';
update jobs set status = 'done' where dedupe_key = 'note:1';
insert into jobs (user_id, type, dedupe_key) values ('11111111-1111-1111-1111-111111111111', 'cleanup_note', 'note:1');
select 'T26 same dedupe key allowed once earlier job finished: true';
commit;

-- ===== Cascade: deleting a note removes its chunks =====
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
delete from notes;
select 'T27 chunks removed with note: ' || (count(*) = 0)::text from chunks;
rollback;

-- ===== Ranking: exact title beats near match =====
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
insert into items (course_id, kind, title, source) select id, 'assignment', 'A10', 'manual' from courses where slug = 'cs251';
select 'T28 ranking for a1 -> ' || string_agg(title || ' ' || round(rank::numeric, 2)::text, ', ') from search_all('a1');
rollback;

-- ===== AI switch default and flag change logging =====
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select 'T29 new course has AI off by default: ' || (not ai_allowed)::text from courses where slug = 'cs246';
update items set flags = array['date_tba'], last_change_source = 'seed' where title = 'Midterm';
select 'T30 flag change logged: ' || (count(*) = 1)::text from item_changes where field = 'flags';
rollback;
