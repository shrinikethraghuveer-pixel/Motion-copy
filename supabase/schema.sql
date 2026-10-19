-- ============================================================================
-- Motion · complete database schema (consolidated)
-- ============================================================================
-- Single-file bootstrap for a fresh Supabase project. Also safe to run on a
-- database that already applied 0001_motion_init.sql / 0002_onboarding.sql:
-- every statement is idempotent (if not exists / or replace / drop-if-exists
-- before create), and it upgrades existing tables in place.
--
-- Supersedes the individual migrations as the canonical reference schema.
-- Run in the Supabase SQL Editor, or: supabase db push
-- ============================================================================

-- ===================================================== extension prerequisites
create extension if not exists pgcrypto; -- gen_random_uuid()

-- =================================================================== profiles
-- One row per auth user, seeded automatically by the on_auth_user_created
-- trigger below.
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text not null unique,
  full_name    text,
  display_name text,          -- preferred public name (falls back to full_name in the UI)
  avatar_url   text,
  bio          text,
  created_at   timestamptz not null default timezone('utc'::text, now())
);

-- Onboarding questionnaire columns (spec 0002) — kept so live code keeps
-- working on a database created from this consolidated file.
alter table public.profiles
  add column if not exists age int,
  add column if not exists interests text[] not null default '{}',
  add column if not exists goal text,
  add column if not exists feed_vibe text,
  add column if not exists onboarding_completed boolean not null default false,
  add column if not exists currently_in_educational_institution boolean,
  add column if not exists institution_id text,
  add column if not exists institution_not_listed boolean not null default false,
  add column if not exists institution_custom_name text;

-- ====================================================================== posts
create table if not exists public.posts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  content       text not null,
  media_url     text,
  post_type     text not null default 'text' check (post_type in ('text', 'event', 'poll')),
  event_details jsonb,
  poll_details  jsonb,
  media_urls    text[] not null default '{}',
  is_ai_generated boolean not null default false, -- feeds the "Groq AI Generated" badge
  ai_prompt       text,        -- prompt that produced this content, when AI-generated
  likes_count   int  not null default 0,
  reposts_count int  not null default 0,
  replies_count int  not null default 0,
  created_at    timestamptz not null default timezone('utc'::text, now())
);

alter table public.posts
  add column if not exists post_type text not null default 'text'
    check (post_type in ('text', 'event', 'poll')),
  add column if not exists event_details jsonb,
  add column if not exists poll_details jsonb,
  add column if not exists media_urls text[] not null default '{}',
  -- Columns present on the live database (added out-of-band); recorded here so
  -- a fresh install matches the live schema that migration 0012's policy uses.
  add column if not exists audience_scope character varying,
  add column if not exists gif_url text,
  add column if not exists poll_data jsonb,
  add column if not exists event_data jsonb,
  add column if not exists group_id uuid;

-- ============================================================= ai_generations
-- Audit/history of every Groq completion, scoped strictly to its owner.
create table if not exists public.ai_generations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  prompt     text not null,
  response   text not null,
  model_used text not null default 'openai/gpt-oss-20b',
  created_at timestamptz not null default timezone('utc'::text, now())
);

-- ================================================= automated profile creation
-- Seeds public.profiles whenever a user registers via Supabase Auth.
-- username: metadata.username -> email local-part fallback -> "user_<id8>",
-- with a uniqueness fallback suffix on collision.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_handle text;
  profile_name text;
begin
  profile_name := coalesce(
    nullif(btrim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data->>'name'), ''),
    nullif(btrim(new.raw_user_meta_data->>'given_name'), '')
  );
  base_handle := lower(regexp_replace(
    coalesce(
      nullif(btrim(new.raw_user_meta_data->>'username'), ''),
      nullif(btrim(new.raw_user_meta_data->>'preferred_username'), ''),
      nullif(btrim(new.raw_user_meta_data->>'user_name'), ''),
      profile_name,
      split_part(coalesce(new.email, ''), '@', 1),
      'user_' || left(new.id::text, 8)
    ),
    '[^a-zA-Z0-9_.-]+', '_', 'g'
  ));
  base_handle := trim(both '_.' from left(base_handle, 30));
  if base_handle = '' then
    base_handle := 'user_' || left(new.id::text, 8);
  end if;

  insert into public.profiles (id, username, full_name, avatar_url)
  values (new.id, base_handle, profile_name,
    coalesce(nullif(new.raw_user_meta_data->>'avatar_url', ''), nullif(new.raw_user_meta_data->>'picture', '')))
  on conflict (id) do nothing;
  return new;
exception when unique_violation then
    insert into public.profiles (id, username, full_name, avatar_url)
    values (
      new.id,
      left(base_handle, 20) || '_' || left(new.id::text, 8),
      profile_name,
      coalesce(nullif(new.raw_user_meta_data->>'avatar_url', ''), nullif(new.raw_user_meta_data->>'picture', ''))
    )
    on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ======================================================================= rls --
alter table public.profiles       enable row level security;
alter table public.posts          enable row level security;
alter table public.ai_generations enable row level security;

-- profiles: owner can edit their row; SELECT policy (profiles_select_visible)
-- is created below, once can_view_profile() exists.

drop policy if exists "profiles_select_public" on public.profiles;

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- posts: owners insert/delete only their own rows. The SELECT policy
-- (posts_select_visible) is created below, once can_view_profile() exists.

drop policy if exists "posts_select_public" on public.posts;

drop policy if exists "posts_insert_own" on public.posts;
create policy "posts_insert_own"
  on public.posts for insert
  with check (auth.uid() = user_id);

drop policy if exists "posts_delete_own" on public.posts;
create policy "posts_delete_own"
  on public.posts for delete
  using (auth.uid() = user_id);

-- ai_generations: strictly owner-only, for both reads and writes. -------------
-- (No public policy at all => invisible to everyone but the owner.)
drop policy if exists "ai_generations_select_own" on public.ai_generations;
create policy "ai_generations_select_own"
  on public.ai_generations for select
  using (auth.uid() = user_id);

drop policy if exists "ai_generations_insert_own" on public.ai_generations;
create policy "ai_generations_insert_own"
  on public.ai_generations for insert
  with check (auth.uid() = user_id);

drop policy if exists "ai_generations_update_own" on public.ai_generations;
create policy "ai_generations_update_own"
  on public.ai_generations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "ai_generations_delete_own" on public.ai_generations;
create policy "ai_generations_delete_own"
  on public.ai_generations for delete
  using (auth.uid() = user_id);

-- Profile rich fields for the dynamic /profile/[username] route (0003).
alter table public.profiles
  add column if not exists cover_url   text,
  add column if not exists headline    text,
  add column if not exists location    text,
  add column if not exists website_url text,
  add column if not exists github_url  text,
  add column if not exists linkedin_url text,
  add column if not exists tech_stack  text[] not null default '{}';

-- ===================================================================== follows
create table if not exists public.follows (
  follower_id  uuid not null references public.profiles (id) on delete cascade,
  following_id uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default timezone('utc'::text, now()),
  primary key (follower_id, following_id)
);
create index if not exists follows_follower_idx on public.follows (follower_id);
create index if not exists follows_following_idx on public.follows (following_id);
alter table public.follows enable row level security;
drop policy if exists "follows_select_public" on public.follows;
create policy "follows_select_public" on public.follows for select using (true);
drop policy if exists "follows_insert_own" on public.follows;
create policy "follows_insert_own" on public.follows for insert with check (auth.uid() = follower_id);
drop policy if exists "follows_delete_own" on public.follows;
create policy "follows_delete_own" on public.follows for delete using (auth.uid() = follower_id);

-- ================================================================= post_likes
create table if not exists public.post_likes (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default timezone('utc'::text, now()),
  primary key (post_id, user_id)
);
create index if not exists post_likes_user_idx on public.post_likes (user_id, created_at desc);
create index if not exists post_likes_post_idx on public.post_likes (post_id);
alter table public.post_likes enable row level security;
drop policy if exists "post_likes_select_public" on public.post_likes;
create policy "post_likes_select_public" on public.post_likes for select using (true);
drop policy if exists "post_likes_insert_own" on public.post_likes;
create policy "post_likes_insert_own" on public.post_likes for insert with check (auth.uid() = user_id);
drop policy if exists "post_likes_delete_own" on public.post_likes;
create policy "post_likes_delete_own" on public.post_likes for delete using (auth.uid() = user_id);

-- ================================================================ saved_posts
create table if not exists public.saved_posts (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default timezone('utc'::text, now()),
  primary key (post_id, user_id)
);
create index if not exists saved_posts_user_idx on public.saved_posts (user_id, created_at desc);
alter table public.saved_posts enable row level security;
drop policy if exists "saved_posts_select_own" on public.saved_posts;
create policy "saved_posts_select_own" on public.saved_posts for select using (auth.uid() = user_id);
drop policy if exists "saved_posts_insert_own" on public.saved_posts;
create policy "saved_posts_insert_own" on public.saved_posts for insert with check (auth.uid() = user_id);
drop policy if exists "saved_posts_delete_own" on public.saved_posts;
create policy "saved_posts_delete_own" on public.saved_posts for delete using (auth.uid() = user_id);

-- ================================================== storage: avatars / banners
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('banners', 'banners', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('post-media', 'post-media', true) on conflict (id) do nothing;

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects for select using (bucket_id = 'avatars');
drop policy if exists "banners_public_read" on storage.objects;
create policy "banners_public_read" on storage.objects for select using (bucket_id = 'banners');

drop policy if exists "avatars_owner_write" on storage.objects;
create policy "avatars_owner_write" on storage.objects for insert with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);
drop policy if exists "avatars_owner_update" on storage.objects;
create policy "avatars_owner_update" on storage.objects for update using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);
drop policy if exists "avatars_owner_delete" on storage.objects;
create policy "avatars_owner_delete" on storage.objects for delete using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "banners_owner_write" on storage.objects;
create policy "banners_owner_write" on storage.objects for insert with check (bucket_id = 'banners' and auth.uid()::text = (storage.foldername(name))[1]);
drop policy if exists "banners_owner_update" on storage.objects;
create policy "banners_owner_update" on storage.objects for update using (bucket_id = 'banners' and auth.uid()::text = (storage.foldername(name))[1]);
drop policy if exists "banners_owner_delete" on storage.objects;
create policy "banners_owner_delete" on storage.objects for delete using (bucket_id = 'banners' and auth.uid()::text = (storage.foldername(name))[1]);
drop policy if exists "post_media_public_read" on storage.objects;
create policy "post_media_public_read" on storage.objects for select using (bucket_id = 'post-media');
drop policy if exists "post_media_owner_insert" on storage.objects;
create policy "post_media_owner_insert" on storage.objects for insert with check (bucket_id = 'post-media' and auth.uid()::text = (storage.foldername(name))[1]);
drop policy if exists "post_media_owner_update" on storage.objects;
create policy "post_media_owner_update" on storage.objects for update using (bucket_id = 'post-media' and auth.uid()::text = (storage.foldername(name))[1]);
drop policy if exists "post_media_owner_delete" on storage.objects;
create policy "post_media_owner_delete" on storage.objects for delete using (bucket_id = 'post-media' and auth.uid()::text = (storage.foldername(name))[1]);

-- ============================================================ direct messages
-- One row per DM message. Realtime-streamed through supabase_realtime so
-- messaging surfaces append incoming messages without a page refresh.
create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  sender_id   uuid not null references public.profiles (id) on delete cascade,
  receiver_id uuid not null references public.profiles (id) on delete cascade,
  content     text not null,
  read        boolean not null default false,
  created_at  timestamptz not null default timezone('utc'::text, now())
);

create index if not exists messages_pair_created_idx on public.messages (created_at desc);
create index if not exists messages_sender_idx   on public.messages (sender_id, created_at desc);
create index if not exists messages_receiver_idx on public.messages (receiver_id, created_at desc);

alter table public.messages enable row level security;

-- Senders may insert their own messages (never to themselves).
drop policy if exists "messages_insert_own" on public.messages;
create policy "messages_insert_own"
  on public.messages for insert
  with check (auth.uid() = sender_id and sender_id <> receiver_id);

-- Participants read the threads they belong to (sender or receiver).
drop policy if exists "messages_select_participants" on public.messages;
create policy "messages_select_participants"
  on public.messages for select
  using (auth.uid() in (sender_id, receiver_id));

-- Only the receiver flips the read receipt.
drop policy if exists "messages_read_own_receipt" on public.messages;
create policy "messages_read_own_receipt"
  on public.messages for update
  using (auth.uid() = receiver_id)
  with check (auth.uid() = receiver_id);

-- Stream insert/update events to subscribed clients.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
     )
  then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

-- ================================================================ group chats
-- Group conversations alongside 1-on-1 DMs.
create table if not exists public.group_chats (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  avatar_url  text,
  created_by  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.group_members (
  group_id  uuid not null references public.group_chats (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  role      text not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamptz not null default timezone('utc'::text, now()),
  primary key (group_id, user_id)
);
create index if not exists group_members_user_idx on public.group_members (user_id);
create index if not exists group_members_group_idx on public.group_members (group_id);

alter table public.group_chats enable row level security;
alter table public.group_members enable row level security;

-- Group metadata is visible to members.
drop policy if exists "group_chats_select_members" on public.group_chats;
create policy "group_chats_select_members"
  on public.group_chats for select
  using (exists (select 1 from public.group_members gm where gm.group_id = id and gm.user_id = auth.uid()));

-- Anyone authenticated can create a group row directly (pre-0014 live state
-- restored byte-for-byte from supabase/migrations/0014 rollback capture).
drop policy if exists "Authenticated users can create group chats" on public.group_chats;
create policy "Authenticated users can create group chats"
  on public.group_chats for insert
  to public
  with check (auth.role() = 'authenticated'::text);

drop policy if exists "group_chats_update_admin" on public.group_chats;
create policy "group_chats_update_admin"
  on public.group_chats for update
  using (exists (select 1 from public.group_members gm where gm.group_id = id and gm.user_id = auth.uid() and gm.role = 'admin'))
  with check (exists (select 1 from public.group_members gm where gm.group_id = id and gm.user_id = auth.uid() and gm.role = 'admin'));

-- Members read the roster via the recursive membership check (the RLS
-- recursion pattern 0013 fixes; byte-for-byte from the 0013 rollback capture).
drop policy if exists "Users can view members of their groups" on public.group_members;
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

-- Pre-0014 live membership INSERT policy, byte-for-byte from the 0014
-- rollback capture (auth.role() check; the policy 0014 tightens).
drop policy if exists "Group admins/creators can add members" on public.group_members;
create policy "Group admins/creators can add members"
  on public.group_members
  as permissive
  for insert
  to public
  with check (auth.role() = 'authenticated'::text);

drop policy if exists "group_members_delete_own" on public.group_members;
create policy "group_members_delete_own"
  on public.group_members for delete
  using (user_id = auth.uid()
    -- outer reference qualified: a bare `group_id` inside this subquery binds
    -- to the alias `gm` first and normalizes to gm.group_id = gm.group_id
    -- (always true). Matches migration 0018.
    or exists (select 1 from public.group_members gm where gm.group_id = group_members.group_id and gm.user_id = auth.uid() and gm.role = 'admin'));

-- messages: allow group rows — receiver_id becomes nullable and group_id links
-- to group_chats. Idempotent upgrades for databases that ran the earlier file.
alter table public.messages
  add column if not exists group_id uuid references public.group_chats (id) on delete cascade;
alter table public.messages alter column receiver_id drop not null;

-- Widen the participant policies to cover group members.
drop policy if exists "messages_select_participants" on public.messages;
create policy "messages_select_participants"
  on public.messages for select
  using (
    auth.uid() in (sender_id, receiver_id)
    -- outer reference qualified: a bare `group_id` inside this subquery binds
    -- to the alias `gm` first and normalizes to gm.group_id = gm.group_id
    -- (always true). Matches migration 0018.
    or (messages.group_id is not null and exists (
      select 1 from public.group_members gm where gm.group_id = messages.group_id and gm.user_id = auth.uid()
    ))
  );

-- Pre-0013 live INSERT policies, byte-for-byte from the 0013 rollback
-- capture: a sender-only bypass ("Users can send messages") OR-combined with
-- the DM/group-membership rule. 0013 removes the sender-only policy.
drop policy if exists "messages_insert_own" on public.messages;

drop policy if exists "Users can send messages" on public.messages;
create policy "Users can send messages"
  on public.messages
  as permissive
  for insert
  to public
  with check (auth.uid() = sender_id);

drop policy if exists "Users can send DM or group messages" on public.messages;
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

create index if not exists messages_group_created_idx on public.messages (group_id, created_at desc);

-- Realtime already streams public.messages (added above) — group INSERTs ride
-- the same publication.

-- ==================================================================== indexes
create index if not exists posts_created_at_idx  on public.posts (created_at desc);
create index if not exists posts_type_created_at_idx on public.posts (post_type, created_at desc);
create index if not exists posts_user_id_idx     on public.posts (user_id);
create index if not exists profiles_username_idx on public.profiles (username);
create index if not exists ai_generations_user_created_idx
  on public.ai_generations (user_id, created_at desc);

-- ================================================================= settings
alter table public.profiles
  add column if not exists school text,
  add column if not exists phone text,
  add column if not exists banner_url text,
  add column if not exists is_deactivated boolean not null default false,
  add column if not exists deactivated_at timestamptz,
  add column if not exists deactivation_reason text,
  add column if not exists deactivation_reason_details text,
  add column if not exists scheduled_reactivation_at timestamptz;

alter table public.profiles
  drop constraint if exists profiles_deactivation_reason_details_length,
  add constraint profiles_deactivation_reason_details_length
    check (deactivation_reason_details is null or char_length(deactivation_reason_details) <= 1000);

alter table public.profiles
  drop constraint if exists profiles_deactivation_schedule_state,
  add constraint profiles_deactivation_schedule_state
    check (
      (not is_deactivated and deactivated_at is null and scheduled_reactivation_at is null)
      or is_deactivated
    );

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
create table if not exists public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(blocker_id,blocked_id), check(blocker_id<>blocked_id)
);
create table if not exists public.user_mutes (
  muter_id uuid not null references public.profiles(id) on delete cascade,
  muted_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(muter_id,muted_id), check(muter_id<>muted_id)
);
create table if not exists public.user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('user','post')),
  target_id text not null,
  reason text not null check (length(reason) between 1 and 1000),
  status text not null default 'pending' check (status in ('pending','dismissed','actioned')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null
);
create index if not exists user_reports_queue_idx on public.user_reports(status, created_at desc);
create index if not exists user_reports_target_idx on public.user_reports(target_type, target_id);
create table if not exists public.connections (
  requester_id uuid not null references public.profiles(id) on delete cascade,
  target_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','accepted')),
  created_at timestamptz not null default now(), primary key(requester_id,target_id), check(requester_id<>target_id)
);
create index if not exists connections_target_status_idx on public.connections(target_id,status);

-- Profile visibility. Mute is deliberately NOT consulted here: muting a user
-- hides their posts from the viewer's feed (see posts_select_visible) but must
-- never block or grant profile access.
create or replace function public.can_view_profile(owner_id uuid, viewer_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
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
-- NOTE: public.search_discoverable_profiles is intentionally NOT defined in
-- this baseline -- it is created by migration 0015 over this exact schema.
-- The browser discovery/search path (src/lib/dm-backends.ts) depends on it
-- and stays unavailable until 0012-0017 have been replayed on a fresh clone.

create or replace function public.delete_my_account()
returns boolean language plpgsql security definer set search_path=public,auth as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  delete from auth.users where id=auth.uid(); return true;
end;
$$;
revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

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

alter table public.user_settings enable row level security;
alter table public.user_blocks enable row level security;
alter table public.user_mutes enable row level security;
alter table public.user_reports enable row level security;
grant insert, select on public.user_reports to authenticated;
alter table public.connections enable row level security;
drop policy if exists "user_settings_owner_all" on public.user_settings;
create policy "user_settings_owner_all" on public.user_settings for all using(auth.uid()=user_id) with check(auth.uid()=user_id);
drop policy if exists "user_blocks_owner_all" on public.user_blocks;
create policy "user_blocks_owner_all" on public.user_blocks for all using(auth.uid()=blocker_id) with check(auth.uid()=blocker_id);
drop policy if exists "user_mutes_owner_all" on public.user_mutes;
create policy "user_mutes_owner_all" on public.user_mutes for all using(auth.uid()=muter_id) with check(auth.uid()=muter_id);
drop policy if exists "user_reports_submit_own" on public.user_reports;
create policy "user_reports_submit_own" on public.user_reports for insert with check(auth.uid()=reporter_id);
drop policy if exists "user_reports_read_own" on public.user_reports;
create policy "user_reports_read_own" on public.user_reports for select using(auth.uid()=reporter_id);
drop policy if exists "connections_participant_read" on public.connections;
create policy "connections_participant_read" on public.connections for select using(auth.uid() in(requester_id,target_id));
drop policy if exists "connections_participant_insert" on public.connections;
create policy "connections_participant_insert" on public.connections for insert with check(auth.uid()=requester_id);
drop policy if exists "connections_participant_update" on public.connections;
create policy "connections_participant_update" on public.connections for update using(auth.uid() in(requester_id,target_id)) with check(auth.uid() in(requester_id,target_id));
drop policy if exists "connections_participant_delete" on public.connections;
create policy "connections_participant_delete" on public.connections for delete using(auth.uid() in(requester_id,target_id));
drop policy if exists "profiles_select_public" on public.profiles;
drop policy if exists "profiles_select_visible" on public.profiles;
create policy "profiles_select_visible" on public.profiles for select using(public.can_view_profile(id,auth.uid()));
drop policy if exists "posts_select_public" on public.posts;
drop policy if exists "posts_select_visible" on public.posts;
-- Sole permissive SELECT policy on posts. Blocks are enforced inside
-- can_view_profile (both directions); mute is viewer-specific feed filtering.
-- Audience rules: NULL/unknown scope fails closed; 'Everyone' without a group
-- is public; any group post requires membership. See migration 0012.
create policy "posts_select_visible" on public.posts for select to public using(
  (
    lower(posts.audience_scope) = 'everyone'
    and posts.group_id is null
    and public.can_view_profile(posts.user_id,auth.uid())
    and not exists(select 1 from public.user_mutes m where m.muter_id=auth.uid() and m.muted_id=posts.user_id)
  )
  or (
    posts.group_id is not null
    and lower(posts.audience_scope) in ('everyone','community only','members only')
    and exists(select 1 from public.group_members gm where gm.group_id = posts.group_id and gm.user_id = auth.uid())
    and public.can_view_profile(posts.user_id,auth.uid())
    and not exists(select 1 from public.user_mutes m where m.muter_id=auth.uid() and m.muted_id=posts.user_id)
  ));

insert into storage.buckets(id,name,public) values('avatars','avatars',true) on conflict(id) do nothing;
insert into storage.buckets(id,name,public) values('banners','banners',true) on conflict(id) do nothing;
insert into storage.buckets(id,name,public) values('post-media','post-media',true) on conflict(id) do nothing;
drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects for select using(bucket_id='avatars');
drop policy if exists "banners_public_read" on storage.objects;
create policy "banners_public_read" on storage.objects for select using(bucket_id='banners');
drop policy if exists "avatars_owner_write" on storage.objects;
create policy "avatars_owner_write" on storage.objects for insert with check(bucket_id='avatars' and auth.uid()::text=(storage.foldername(name))[1]);
drop policy if exists "avatars_owner_update" on storage.objects;
create policy "avatars_owner_update" on storage.objects for update using(bucket_id='avatars' and auth.uid()::text=(storage.foldername(name))[1]);
drop policy if exists "avatars_owner_delete" on storage.objects;
create policy "avatars_owner_delete" on storage.objects for delete using(bucket_id='avatars' and auth.uid()::text=(storage.foldername(name))[1]);
drop policy if exists "banners_owner_write" on storage.objects;
create policy "banners_owner_write" on storage.objects for insert with check(bucket_id='banners' and auth.uid()::text=(storage.foldername(name))[1]);
drop policy if exists "banners_owner_update" on storage.objects;
create policy "banners_owner_update" on storage.objects for update using(bucket_id='banners' and auth.uid()::text=(storage.foldername(name))[1]);
drop policy if exists "banners_owner_delete" on storage.objects;
create policy "banners_owner_delete" on storage.objects for delete using(bucket_id='banners' and auth.uid()::text=(storage.foldername(name))[1]);
drop policy if exists "post_media_public_read" on storage.objects;
create policy "post_media_public_read" on storage.objects for select using(bucket_id='post-media');
drop policy if exists "post_media_owner_insert" on storage.objects;
create policy "post_media_owner_insert" on storage.objects for insert with check(bucket_id='post-media' and auth.uid()::text=(storage.foldername(name))[1]);
drop policy if exists "post_media_owner_update" on storage.objects;
create policy "post_media_owner_update" on storage.objects for update using(bucket_id='post-media' and auth.uid()::text=(storage.foldername(name))[1]);
drop policy if exists "post_media_owner_delete" on storage.objects;
create policy "post_media_owner_delete" on storage.objects for delete using(bucket_id='post-media' and auth.uid()::text=(storage.foldername(name))[1]);
