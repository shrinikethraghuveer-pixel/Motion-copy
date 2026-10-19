-- ============================================================================
-- 0017 -- DB-side block governance for group chat creation and invites
--
-- STATUS: PROPOSAL ONLY. Depends on 0014 ("create_group_chat_with_members"
-- and the admin-only group_members INSERT policy). Applying 0017 before 0014
-- fails loudly because the CREATE OR REPLACE target function will not exist.
-- Do not apply without the rollback and the updated pre-deployment checklist.
--
-- PROBLEM (audit finding P3 parity gap, Supabase plane):
--   The app plane (legacy JSON store) rejects group chat invites that place
--   the creator back in a conversation with someone they blocked (either
--   direction) and refuse deactivated/deleted accounts:
--     src/app/api/group-chats/route.ts create + addMembers paths
--     src/lib/group-governance.ts is-blocked-between.
--   The Supabase function created by 0014 accepts ANY caller-supplied uuid[]
--   and inserts every unique id: no block check, no deactivation check, no
--   existence check beyond the FK constraint (FK violation aborts the whole
--   call — that is good, but only message says FK violation).
--   The browser member-invite path (src/lib/dm-backends.ts addGroupMembers)
--   performs direct INSERTs, which 0014 gates to admins (authorization is
--   enforced) but with zero block governance (behavioral gap remains).
--
-- PRODUCT DECISION REQUIRED BEFORE APPLYING (not guessed here):
--   1. Fail loudly vs. silently-filter. The app plane QUIETLY SKIPS blocked
--      invitees and returns 403 naming the rejected handles. This migration
--      proposes FAILING THE WHOLE CALL with a clear error so callers can show
--      403 — because partial-success group creation (block a member later,
--      rows already inserted) is hard to undo inside one SQL statement. If
--      product prefers silent filtering, the loop below changes from RAISE to
--      EXCLUDE (the transactional-integrity tradeoff is then theirs to own).
--   2. Group-size cap. 0014 explicitly declined a cap ("no app requirement
--      grounds a limit"). The app plane enforces MAX_DM_GROUP_MEMBERS = 20.
--      This migration does NOT add a cap — it stays a 0014/product decision.
--
-- BLOCK DATA SOURCE: public.user_blocks (blocker_id, blocked_id) — 0004, with
-- RLS "user_blocks_owner_all". The SECURITY DEFINER RPC runs as owner
-- (relforcerowsecurity = false per the 2026-10-17 capture — RE-VERIFY), so
-- checking OTHER users' block rows here is deliberate: an RPC created with
-- WITHOUT definer cannot read the opposing direction's block rows and the
-- check would be one-sided.
--
-- DEACTIVATION SOURCE: public.profiles.is_deactivated (0011).
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Shared helper: invitee roster validation used by BOTH functions.
--    Raises with a stable SQLSTATE (42501) and a message the UI can show.
--    Excluded from regression equivalence: matches is_blocked_between in
--    src/lib/group-governance.ts (both directions).
-- ---------------------------------------------------------------------------
create or replace function public.assert_inviteable(p_creator_id uuid, p_invitee_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if p_invitee_id = p_creator_id then
    return; -- the creator row is inserted separately by the caller.
  end if;
  if not exists (select 1 from public.profiles pr where pr.id = p_invitee_id) then
    raise exception 'Invite is not available: member not found (%).', p_invitee_id
      using errcode = '42501';
  end if;
  if exists (
    select 1 from public.profiles pr where pr.id = p_invitee_id and pr.is_deactivated
  ) then
    raise exception 'Invite is not available: % is deactivated.', p_invitee_id
      using errcode = '42501';
  end if;
  if exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = p_creator_id and b.blocked_id = p_invitee_id)
       or (b.blocker_id = p_invitee_id and b.blocked_id = p_creator_id)
  ) then
    raise exception 'Invite is not available: you are blocked with %.', p_invitee_id
      using errcode = '42501';
  end if;
end;
$fn$;

alter function public.assert_inviteable(uuid, uuid) owner to postgres;
revoke execute on function public.assert_inviteable(uuid, uuid) from public;
revoke execute on function public.assert_inviteable(uuid, uuid) from anon;

-- ---------------------------------------------------------------------------
-- 2. create_group_chat_with_members: same contract as 0014 (returns the new
--    group id), now with creator + invitee governance (no call-side choice of
--    role or created_by; invitees cannot be blocked-in-either-direction with
--    the creator, deactivated, or nonexistent).
-- ---------------------------------------------------------------------------
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
  v_invitee record;
begin
  if v_caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  for v_invitee in
    select distinct member_id as invitee_id
    from unnest(coalesce(p_member_ids, '{}'::uuid[])) as member_id
  loop
    perform public.assert_inviteable(v_caller_id, v_invitee.invitee_id);
  end loop;

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

-- ---------------------------------------------------------------------------
-- 3. invite_group_members: admin-only roster extension with the same
--    governance (creator = current admin), atomic (single call, whole
--    transaction rolls back on the first rejected invitee), and it returns
--    the number of NEW member rows inserted.
-- ---------------------------------------------------------------------------
create function public.invite_group_members(
  p_group_id uuid,
  p_member_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_caller_id uuid := auth.uid();
  v_added integer := 0;
  v_invitee record;
begin
  if v_caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not public.is_current_user_group_admin(p_group_id) then
    raise exception 'Only group admins can add members.' using errcode = '42501';
  end if;

  for v_invitee in
    select distinct member_id as invitee_id
    from unnest(coalesce(p_member_ids, '{}'::uuid[])) as member_id
  loop
    -- Self row (already a member) and duplicate group_members rows are fine to
    -- skip; the GOVERNANCE checks below still apply to every genuinely-new id.
    perform public.assert_inviteable(v_caller_id, v_invitee.invitee_id);
    if not exists (
      select 1 from public.group_members gm
      where gm.group_id = p_group_id and gm.user_id = v_invitee.invitee_id
    ) then
      insert into public.group_members (group_id, user_id, role)
      values (p_group_id, v_invitee.invitee_id, 'member');
      v_added := v_added + 1;
    end if;
  end loop;

  return v_added;
end;
$fn$;

alter function public.invite_group_members(uuid, uuid[]) owner to postgres;
revoke execute on function public.invite_group_members(uuid, uuid[]) from public;
grant execute on function public.invite_group_members(uuid, uuid[]) to authenticated;

commit;

-- Review before execution:
-- * 0014 applied first (functions exist at these signatures; CREATE OR REPLACE
--   of create_group_chat_with_members is the first DB-visible change).
-- * RE-CAPTURE live catalog: pg_policies on group_members unchanged by this
--   file (INSERT policy from 0014 stays the only admin-gate), relforcerowsecurity
--   = false on profiles/group_members/group_chats/user_blocks, and no other
--   function named assert_inviteable/invite_group_members exists.
-- * Product decision on fail-loudly vs. silent filtering recorded BEFORE
--   applying (see header).
-- * The caller switch in src/lib/dm-backends.ts ships in the same deployment.
