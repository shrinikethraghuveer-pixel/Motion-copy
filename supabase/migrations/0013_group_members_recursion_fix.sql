-- ============================================================================
-- 0013 -- Fix RLS recursion on public.group_members (live-policy revision)
--
-- STATUS: PROPOSAL ONLY. This file has not been applied.
--
-- Source of truth: the 2026-10-16 live pg_policies capture. This migration
-- changes only policies that actually appeared in that capture:
--   * "Users can view members of their groups" on public.group_members
--   * the two public.messages INSERT policies, to remove the permissive
--     sender-only bypass while retaining the captured DM/group rule.
--
-- It deliberately does NOT create repository-only policy names, and does NOT
-- alter group_chats SELECT, messages SELECT, posts SELECT, group_members
-- INSERT, group_members DELETE, or group_chats UPDATE policies.
-- ============================================================================

begin;

-- This accepts only a group ID. The subject is always the caller's auth.uid(),
-- so callers cannot probe membership of arbitrary users. postgres owns
-- group_members and FORCE RLS is false in the captured live table metadata;
-- therefore this SECURITY DEFINER read bypasses the policy being evaluated.
-- CREATE (not CREATE OR REPLACE) prevents an unrelated existing helper with
-- this signature from being silently overwritten.
create function public.is_current_user_group_member(p_group_id uuid)
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
  )
$fn$;

alter function public.is_current_user_group_member(uuid) owner to postgres;
revoke execute on function public.is_current_user_group_member(uuid) from public;
grant execute on function public.is_current_user_group_member(uuid) to anon, authenticated;

-- LIVE BEFORE (captured): PERMISSIVE, TO public, SELECT
--   exists (select 1 from group_members gm
--           where gm.group_id = group_members.group_id
--             and gm.user_id = auth.uid())
-- Replacing only the recursive lookup preserves same-group roster visibility.
drop policy "Users can view members of their groups" on public.group_members;
create policy "Users can view members of their groups"
  on public.group_members
  as permissive
  for select
  to public
  using (public.is_current_user_group_member(group_members.group_id));

-- LIVE BEFORE: two PERMISSIVE, TO public INSERT policies are OR-combined.
-- "Users can send messages" requires only auth.uid() = sender_id, so it
-- bypasses the group-membership condition in the other policy. Remove that
-- redundant broad policy and retain the captured DM-or-group policy, changing
-- only its membership subquery to the non-recursive helper.
drop policy "Users can send messages" on public.messages;
drop policy "Users can send DM or group messages" on public.messages;
create policy "Users can send DM or group messages"
  on public.messages
  as permissive
  for insert
  to public
  with check (
    auth.uid() = sender_id
    and (
      receiver_id is not null
      or (
        group_id is not null
        and public.is_current_user_group_member(messages.group_id)
      )
    )
  );

commit;

-- Review before execution:
-- * "Group admins/creators can add members" is intentionally untouched. The
--   captured expression checks only auth.role() = 'authenticated'; its name
--   and body conflict, and changing it needs an explicit product decision.
-- * The retained message policy preserves its captured receiver_id OR group_id
--   shape. A database constraint deciding whether both columns may be non-NULL
--   was not in the policy capture and is outside this recursion fix.
