-- ============================================================================
-- 0018 — Fix SQL column name-resolution defects in two RLS policies
--
-- Verified defect (stored-policy normalization review, 2026-10-19): both
-- subqueries reference the outer row's group id with a bare `group_id`, which
-- PostgreSQL binds to the innermost alias `gm` first, so the comparison
-- normalized to `gm.group_id = gm.group_id` (always true):
--   * group_members_delete_own — the admin arm granted "admin of any group"
--     semantics; on the current schema cross-group deletes were only blocked
--     by the separate row-visibility gate of the group_members SELECT policy
--     (a defense-in-depth hole, not an independent guard).
--   * messages_select_participants — the group arm let any member of any
--     group read any group's messages (verified cross-group read in the
--     baseline test: u1/u2/u4 all read Group B's message, expected 0).
-- Fix: qualify the outer references, using the same patterns already used
-- correctly elsewhere in this repository (0012's posts_select_visible
-- `posts.group_id`, the pre-0013 roster policy `group_members.group_id`).
--
-- Scope: ONLY these two policies. The 0013 helper-based roster SELECT, 0014's
-- admin-only membership INSERT, the messages INSERT policy, and everything
-- else are untouched. Idempotent; no rows are read or modified.
-- ============================================================================

begin;

drop policy if exists "group_members_delete_own" on public.group_members;
create policy "group_members_delete_own"
  on public.group_members for delete
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.group_members gm
      where gm.group_id = group_members.group_id
        and gm.user_id = auth.uid()
        and gm.role = 'admin'
    )
  );

drop policy if exists "messages_select_participants" on public.messages;
create policy "messages_select_participants"
  on public.messages for select
  using (
    auth.uid() in (sender_id, receiver_id)
    or (messages.group_id is not null and exists (
      select 1
      from public.group_members gm
      where gm.group_id = messages.group_id
        and gm.user_id = auth.uid()
    ))
  );

commit;
