-- Persistent account preferences and safety lists.
alter table public.profiles
  add column if not exists school text,
  add column if not exists phone text,
  add column if not exists banner_url text,
  add column if not exists is_deactivated boolean not null default false;

create table if not exists public.user_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  is_private boolean not null default false,
  campus_discovery boolean not null default true,
  dm_audience text not null default 'everyone' check (dm_audience in ('everyone','connections','none')),
  tagging_audience text not null default 'everyone' check (tagging_audience in ('everyone','connections','off')),
  notify_connections boolean not null default true,
  notify_events boolean not null default true,
  notify_polls boolean not null default true,
  notify_social boolean not null default true,
  email_digest text not null default 'weekly' check (email_digest in ('off','daily','weekly')),
  theme text not null default 'dark' check (theme in ('dark','light','system')),
  theme_mode text not null default 'dark' check (theme_mode in ('dark','light','system')),
  accent_color text not null default '#7c3aed',
  low_spec_mode boolean not null default false,
  ai_post_sharpening boolean not null default true,
  ai_smart_ranking boolean not null default true,
  ai_default_model text not null default 'openai/gpt-oss-20b',
  two_factor_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.user_settings
  add column if not exists is_private boolean not null default false,
  add column if not exists campus_discovery boolean not null default true,
  add column if not exists dm_audience text not null default 'everyone',
  add column if not exists tagging_audience text not null default 'everyone',
  add column if not exists theme_mode text not null default 'dark',
  add column if not exists theme text not null default 'dark',
  add column if not exists accent_color text not null default '#7c3aed',
  add column if not exists low_spec_mode boolean not null default false;

create table if not exists public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create table if not exists public.user_mutes (
  muter_id uuid not null references public.profiles(id) on delete cascade,
  muted_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter_id, muted_id),
  check (muter_id <> muted_id)
);

create table if not exists public.connections (
  requester_id uuid not null references public.profiles(id) on delete cascade,
  target_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  primary key (requester_id,target_id),
  check (requester_id <> target_id)
);
create index if not exists connections_target_status_idx on public.connections(target_id,status);

create or replace function public.can_view_profile(owner_id uuid, viewer_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select not exists (select 1 from public.profiles p where p.id=owner_id and p.is_deactivated)
    and (
      owner_id = viewer_id
      or exists (select 1 from public.user_blocks b where b.blocker_id=viewer_id and b.blocked_id=owner_id)
      or exists (select 1 from public.user_mutes m where m.muter_id=viewer_id and m.muted_id=owner_id)
      or (
      not exists (select 1 from public.user_settings s where s.user_id=owner_id and s.is_private)
      and not exists (select 1 from public.user_blocks b where (b.blocker_id=owner_id and b.blocked_id=viewer_id) or (b.blocker_id=viewer_id and b.blocked_id=owner_id))
      )
      or exists (
      select 1 from public.connections c
      where c.status='accepted' and ((c.requester_id=owner_id and c.target_id=viewer_id) or (c.requester_id=viewer_id and c.target_id=owner_id))
        and not exists (select 1 from public.user_blocks b where (b.blocker_id=owner_id and b.blocked_id=viewer_id) or (b.blocker_id=viewer_id and b.blocked_id=owner_id))
      )
    );
$$;

create or replace function public.delete_my_account()
returns boolean language plpgsql security definer set search_path=public,auth as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  delete from auth.users where id=auth.uid();
  return true;
end;
$$;
revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

alter table public.connections enable row level security;
drop policy if exists "connections_participant_read" on public.connections;
create policy "connections_participant_read" on public.connections for select using (auth.uid() in (requester_id,target_id));
drop policy if exists "connections_participant_insert" on public.connections;
create policy "connections_participant_insert" on public.connections for insert with check (auth.uid()=requester_id);
drop policy if exists "connections_participant_update" on public.connections;
create policy "connections_participant_update" on public.connections for update using (auth.uid() in (requester_id,target_id)) with check (auth.uid() in (requester_id,target_id));
drop policy if exists "connections_participant_delete" on public.connections;
create policy "connections_participant_delete" on public.connections for delete using (auth.uid() in (requester_id,target_id));

alter table public.user_settings enable row level security;
alter table public.user_blocks enable row level security;
alter table public.user_mutes enable row level security;
drop policy if exists "user_settings_owner_all" on public.user_settings;
create policy "user_settings_owner_all" on public.user_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "user_blocks_owner_all" on public.user_blocks;
create policy "user_blocks_owner_all" on public.user_blocks for all using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id);
drop policy if exists "user_mutes_owner_all" on public.user_mutes;
create policy "user_mutes_owner_all" on public.user_mutes for all using (auth.uid() = muter_id) with check (auth.uid() = muter_id);

drop policy if exists "profiles_select_public" on public.profiles;
create policy "profiles_select_visible" on public.profiles for select using (public.can_view_profile(id,auth.uid()));
drop policy if exists "posts_select_public" on public.posts;
create policy "posts_select_visible" on public.posts for select using (
  public.can_view_profile(user_id,auth.uid())
  and not exists (select 1 from public.user_blocks b where (b.blocker_id=auth.uid() and b.blocked_id=user_id) or (b.blocker_id=user_id and b.blocked_id=auth.uid()))
  and not exists (select 1 from public.user_mutes m where m.muter_id=auth.uid() and m.muted_id=user_id)
);

insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('banners', 'banners', true) on conflict (id) do nothing;
drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects for select using (bucket_id='avatars');
drop policy if exists "banners_public_read" on storage.objects;
create policy "banners_public_read" on storage.objects for select using (bucket_id='banners');
drop policy if exists "avatars_owner_write" on storage.objects;
create policy "avatars_owner_write" on storage.objects for insert with check (bucket_id='avatars' and auth.uid()::text=(storage.foldername(name))[1]);
drop policy if exists "avatars_owner_update" on storage.objects;
create policy "avatars_owner_update" on storage.objects for update using (bucket_id='avatars' and auth.uid()::text=(storage.foldername(name))[1]);
drop policy if exists "avatars_owner_delete" on storage.objects;
create policy "avatars_owner_delete" on storage.objects for delete using (bucket_id='avatars' and auth.uid()::text=(storage.foldername(name))[1]);
drop policy if exists "banners_owner_write" on storage.objects;
create policy "banners_owner_write" on storage.objects for insert with check (bucket_id='banners' and auth.uid()::text=(storage.foldername(name))[1]);
drop policy if exists "banners_owner_update" on storage.objects;
create policy "banners_owner_update" on storage.objects for update using (bucket_id='banners' and auth.uid()::text=(storage.foldername(name))[1]);
drop policy if exists "banners_owner_delete" on storage.objects;
create policy "banners_owner_delete" on storage.objects for delete using (bucket_id='banners' and auth.uid()::text=(storage.foldername(name))[1]);
