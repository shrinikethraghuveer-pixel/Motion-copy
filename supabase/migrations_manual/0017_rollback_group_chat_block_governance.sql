-- ============================================================================
-- 0017 ROLLBACK — restore 0014 function bodies and drop 0017 helpers
--
-- STATUS: PROPOSAL ONLY. Requires 0014 to be applied (its function bodies are
-- recreated verbatim below with the same ACLs as 0014 granted them).
-- ============================================================================

begin;

-- Recreate the 0014 version of create_group_chat_with_members exactly as it
-- shipped there (verbatim body from supabase/migrations/0014, section 2).
create or replace function public.create_group_chat_with_members(
  p_name text,
  p_description text,
  p_avatar_url text,
  p_member_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_caller_id uuid := auth.uid();
  v_group_id uuid;
begin
  if v_caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  insert into public.group_chats (name, description, avatar_url, created_by)
  values (p_name, p_description, p_avatar_url, v_caller_id)
  returning id into v_group_id;

  insert into public.group_members (group_id, user_id, role)
  values (v_group_id, v_caller_id, 'admin');

  insert into public.group_members (group_id, user_id, role)
  select v_group_id, invitee_id, 'member'
  from (
    select distinct member_id as invitee_id
    from unnest(coalesce(p_member_ids, '{}'::uuid[])) as member_id
    where member_id <> v_caller_id
  ) invitees;

  return v_group_id;
end;
$fn$;

alter function public.create_group_chat_with_members(text, text, text, uuid[]) owner to postgres;
revoke execute on function public.create_group_chat_with_members(text, text, text, uuid[]) from public;
grant execute on function public.create_group_chat_with_members(text, text, text, uuid[]) to authenticated;

drop function if exists public.invite_group_members(uuid, uuid[]);
drop function if exists public.assert_inviteable(uuid, uuid);

commit;
