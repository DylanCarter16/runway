-- Ask sends a chunk to Claude only when chunks.course_id belongs to a course with AI on.
-- If a note or document moves to another course, its chunks must move with it, or an
-- AI-off course's text could still carry the old AI-on course id.

create or replace function public.chunks_follow_parent_course()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.chunks
     set course_id = new.course_id
   where parent_type = tg_argv[0]
     and parent_id = new.id
     and course_id is distinct from new.course_id;
  return null;
end;
$$;

create trigger notes_chunks_course
after update of course_id on public.notes
for each row when (old.course_id is distinct from new.course_id)
execute function public.chunks_follow_parent_course('note');

create trigger documents_chunks_course
after update of course_id on public.documents
for each row when (old.course_id is distinct from new.course_id)
execute function public.chunks_follow_parent_course('document');
