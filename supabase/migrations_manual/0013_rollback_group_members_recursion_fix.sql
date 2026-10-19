-- ============================================================================
-- 0013 ROLLBACK -- restore captured live policy definitions
--
-- STATUS: PROPOSAL ONLY. Pairs with 0013_group_members_recursion_fix.sql.
--
-- Restores the exact policy names, commands, roles, permissive mode, and
-- expressions captured from live pg_policies on 2026-10-16. It restores only
-- policies changed by 0013 and drops the helper after no policy uses it.
-- ============================================================================

begin;

-- Restore live: PERMISSIVE, TO public, SELECT.
drop policy "Users can view members of their groups" on public.group_members;
create policy "Users can view members of their groups"
  on public.group_members
  as permissive
  for select
  to public
  using (
    exists (
      select 1
      from public.group_members gm
      where gm.group_id = group_members.group_id
        and gm.user_id = auth.uid()
    )
  );

-- Restore both live PERMISSIVE, TO public INSERT policies. They must both be
-- recreated because PostgreSQL OR-combines permissive INSERT WITH CHECK rules.
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
        and exists (
          select 1
          from public.group_members
          where group_members.group_id = messages.group_id
            and group_members.user_id = auth.uid()
        )
      )
    )
  );

create policy "Users can send messages"
  on public.messages
  as permissive
  for insert
  to public
  with check (auth.uid() = sender_id);

drop function public.is_current_user_group_member(uuid);

commit;
