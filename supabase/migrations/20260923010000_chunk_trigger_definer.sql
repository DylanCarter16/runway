-- Deleting a user from the auth admin API cascades to documents and notes, whose
-- delete triggers remove the matching chunks. Triggers run as the calling role, and
-- supabase_auth_admin has no rights on public.chunks, so the whole delete failed
-- ("Database error deleting user"). Run the trigger function as its owner instead.
-- search_path is already pinned to '' on this function.
alter function public.delete_chunks_for_parent() security definer;
revoke execute on function public.delete_chunks_for_parent() from public, anon, authenticated;
