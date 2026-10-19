-- ============================================================================
-- 0014 -- Secure Supabase group-chat membership creation and invitations
--
-- STATUS: PROPOSAL ONLY. Do not apply without reviewing the companion
-- rollback and docs/group-chat-membership-security-verification.md.
--
-- LIVE BASELINE: verified by SQL Editor capture on 2026-10-17. Facts used
-- below (source: the capture, NOT the repository schema):
--   * public.group_chats / public.group_members / public.messages are owned
--     by postgres, RLS enabled, FORCE RLS = false.
--   * group_chats policies (only these two on the table):
--       "Authenticated users can create group chats" — PERMISSIVE, INSERT,
--         TO public, WITH CHECK (auth.role() = 'authenticated'::text)
--         -> the direct-creation bypass; replaced below.
--       "Users can view groups they belong to" — PERMISSIVE, SELECT
--         -> PRESERVED, untouched here and in the rollback.
--   * group_members policies (only these two on the table):
--       "Group admins/creators can add members" — PERMISSIVE, INSERT,
--         TO public, WITH CHECK (auth.role() = 'authenticated'::text)
--         -> replaced below.
--       "Users can view members of their groups" — PERMISSIVE, SELECT,
--         USING (is_current_user_group_member(group_id))
--         -> PRESERVED (0013 helper, untouched).
--   * public.is_current_user_group_member(uuid) exists live: owner postgres,
--     SECURITY DEFINER, empty search_path, EXECUTE for anon/authenticated/
--     service_role. Untouched here.
--   * NEITHER public.is_current_user_group_admin(uuid) NOR
--     public.create_group_chat_with_members(text,text,text,uuid[]) exists
--     live — so the `create function` statements below cannot collide.
--   * group_members constraints live: role CHECK ('admin'/'member'),
--     UNIQUE (group_id, user_id), both FKs ON DELETE CASCADE.
--
-- The capture is evidence of one point in time. RECAPTURE the full live
-- catalog immediately before applying (pg_policies, pg_proc, function ACLs,
-- pg_class.relowner, relforcerowsecurity) and diff against this baseline;
-- abort on any unexpected drift.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Caller-derived, boolean-only admin check for the membership INSERT
--    policy. SECURITY DEFINER avoids recursive RLS evaluation (owner bypasses
--    RLS; FORCE RLS verified false on 2026-10-17). It has NO user-id argument,
--    so it cannot inspect another user's membership; the subject is always
--    the caller's auth.uid().
--    EXECUTE: revoked from PUBLIC; granted only to authenticated. Documented
--    requirement: its ONLY consumer is the membership INSERT policy marked
--    `to authenticated`, so no other role evaluates the expression — anon
--    therefore needs no EXECUTE (verified behavior assumption listed in the
--    verification doc, since INSERT policies scoped to authenticated are
--    never evaluated for anon).
-- ---------------------------------------------------------------------------
create function public.is_current_user_group_admin(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = auth.uid()
      and gm.role = 'admin'
  )
$fn$;

alter function public.is_current_user_group_admin(uuid) owner to postgres;
revoke execute on function public.is_current_user_group_admin(uuid) from public;
grant execute on function public.is_current_user_group_admin(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Atomic creation: chat row + creator admin row + all initial invitee rows
--    in ONE call. The caller cannot choose created_by or any role. PostgreSQL
--    functions run inside the caller's transaction, so any exception (FK
--    violation for an invalid invitee; unique violation despite the
--    de-duplication below) rolls back the group row and every membership row
--    from this call.
--
--    Ownership precondition is now VERIFIED (2026-10-17 capture): both tables
--    owned by postgres with relforcerowsecurity = false, so this definer
--    function performs its inserts with RLS bypassed — including past the
--    RESTRICTIVE direct-insert block installed in step 4.
--
--    No invitee-count cap is added: no existing app requirement grounds a
--    limit (CreateGroupModal imposes none), and inventing a product limit is
--    out of scope.
-- ---------------------------------------------------------------------------
create function public.create_group_chat_with_members(
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

-- ---------------------------------------------------------------------------
-- 3. Membership INSERT tightening. Drops the verified live policy by its
--    exact name. Existing admins may invite ordinary members; no direct
--    INSERT can bootstrap membership, self-join, or grant/promote admin.
--
--    Drift precondition: the 2026-10-17 capture shows exactly ONE permissive
--    INSERT policy on group_members. If the immediate re-capture before
--    applying reveals any additional permissive INSERT policy on this table,
--    STOP — none would be disabled here and the tightening would leak.
--    (Unlike group_chats below, there is no RESTRICTIVE backstop installed
--    on group_members; adding one for INSERT is impossible because the
--    admin-invite path is itself a permissive policy and the deny/not-deny
--    is role- and value-dependent, i.e. not expressible as a static false
--    check.)
-- ---------------------------------------------------------------------------
DROP POLICY "Group admins/creators can add members" ON public.group_members;
CREATE POLICY "Group admins/creators can add members"
  ON public.group_members
  AS permissive
  FOR INSERT
  TO authenticated
  WITH CHECK (
    role = 'member'
    AND public.is_current_user_group_admin(group_id)
  );

-- ---------------------------------------------------------------------------
-- 4. Close direct group creation. Drops the verified live policy by its
--    exact name ("group_chats_insert_own" does NOT exist live) and installs
--    an always-false RESTRICTIVE INSERT policy:
--    * PostgreSQL RLS semantics: for a non-owner role, permissive policies
--      are OR-combined and restrictive policies are AND-combined; with check
--      (false) makes every AND-false, so NO combination of permissive
--      policies can allow a direct INSERT by authenticated/anon.
--    * The SECURITY DEFINER RPC runs as table owner (postgres), and FORCE
--      RLS = false (verified 2026-10-17), so its inserts bypass RLS
--      entirely — the restrictive policy cannot and does not affect it.
--      Runtime behavior is NOT runtime-tested here; the verification doc
--      has explicit tests for both halves of this claim.
--    * service_role has BYPASSRLS and does not need this policy.
-- ---------------------------------------------------------------------------
DROP POLICY "Authenticated users can create group chats" ON public.group_chats;
CREATE POLICY "group_chats_insert_direct_blocked"
  ON public.group_chats
  AS restrictive
  FOR INSERT
  TO public
  WITH CHECK (false);

commit;

-- Review before execution (all refreshed from the immediate re-capture, not
-- from this file):
-- * pg_policies for both tables matches the 2026-10-17 baseline above,
--   especially: exactly one permissive INSERT policy on group_members, and
--   both SELECT policies present with their verified texts.
-- * pg_class.relowner = postgres and relforcerowsecurity = false for
--   group_chats and group_members.
-- * Neither new function already exists at these signatures.
