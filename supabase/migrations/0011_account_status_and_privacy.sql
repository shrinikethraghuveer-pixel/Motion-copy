-- Group A: account status, secure scheduled reactivation, and visibility.
alter table public.profiles
  add column if not exists deactivated_at timestamptz,
  add column if not exists deactivation_reason text,
  add column if not exists deactivation_reason_details text,
  add column if not exists scheduled_reactivation_at timestamptz;

alter table public.profiles
  drop constraint if exists profiles_deactivation_reason_details_length,
  add constraint profiles_deactivation_reason_details_length
    check (deactivation_reason_details is null or char_length(deactivation_reason_details) <= 1000),
  drop constraint if exists profiles_deactivation_schedule_state,
  add constraint profiles_deactivation_schedule_state
    check (
      (not is_deactivated and deactivated_at is null and scheduled_reactivation_at is null)
      or is_deactivated
    );

-- Called only by a privileged scheduled job. It is idempotent: once a row is
-- reactivated it no longer meets the where clause.
create or replace function public.reactivate_due_accounts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  changed integer;
begin
  update public.profiles
  set is_deactivated = false,
      deactivated_at = null,
      scheduled_reactivation_at = null
  where is_deactivated = true
    and scheduled_reactivation_at is not null
    and scheduled_reactivation_at <= now();
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke all on function public.reactivate_due_accounts() from public;
revoke all on function public.reactivate_due_accounts() from anon;
revoke all on function public.reactivate_due_accounts() from authenticated;
grant execute on function public.reactivate_due_accounts() to service_role;

-- Visibility needs a definer function to avoid recursive RLS checks across
-- profiles, settings, blocks, and connections. It exposes only a boolean.
create or replace function public.can_view_profile(owner_id uuid, viewer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select owner_id = viewer_id
    or (
      not exists (select 1 from public.profiles p where p.id = owner_id and p.is_deactivated)
      and not exists (
        select 1 from public.user_blocks b
        where (b.blocker_id = owner_id and b.blocked_id = viewer_id)
           or (b.blocker_id = viewer_id and b.blocked_id = owner_id)
      )
      and (
        not exists (select 1 from public.user_settings s where s.user_id = owner_id and s.is_private)
        or exists (
          select 1 from public.connections c
          where c.status = 'accepted'
            and ((c.requester_id = owner_id and c.target_id = viewer_id)
              or (c.requester_id = viewer_id and c.target_id = owner_id))
        )
      )
    );
$$;

drop policy if exists "profiles_select_public" on public.profiles;
drop policy if exists "profiles_select_visible" on public.profiles;
create policy "profiles_select_visible" on public.profiles
  for select using (public.can_view_profile(id, auth.uid()));

drop policy if exists "posts_select_public" on public.posts;
drop policy if exists "posts_select_visible" on public.posts;
-- Mute is viewer-specific feed filtering, not profile access: a viewer must
-- not see posts authored by someone they muted. Other eligible viewers are
-- unaffected (the predicate only matches rows the current user muted).
create policy "posts_select_visible" on public.posts
  for select using (
    public.can_view_profile(user_id, auth.uid())
    and not exists (
      select 1 from public.user_mutes m
      where m.muter_id = auth.uid() and m.muted_id = user_id
    )
  );
