-- ============================================================================
-- Motion · 0003 — dynamic profile route, dual-theme liquid glass
-- ============================================================================
-- Adds everything the /profile/[username] page and the inline Edit Profile
-- modal need on top of 0001/0002:
--   · profiles: cover_url, headline, location, website_url, github_url,
--     linkedin_url, tech_stack (text[])
--   · follows (bidirectional follow graph powering follower/following counts)
--   · post_likes (per-user post likes powering the Activity / Likes tab)
--   · saved_posts (bookmarks — only visible on one's own profile)
--   · avatars / banners storage buckets (public read, owner-only write)
-- Every statement is idempotent: safe to run on any environment state.
-- ============================================================================

-- ===================================================== profiles: rich fields
alter table public.profiles
  add column if not exists cover_url   text,
  add column if not exists headline    text,
  add column if not exists location    text,
  add column if not exists website_url text,
  add column if not exists github_url  text,
  add column if not exists linkedin_url text,
  add column if not exists tech_stack  text[] not null default '{}';

-- ==================================================================== follows
-- Follower graph: follower_id follows following_id. A pair is unique in one
-- direction; blocking a user deletes rows in both directions app-side.
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
create policy "follows_select_public"
  on public.follows for select
  using (true);

drop policy if exists "follows_insert_own" on public.follows;
create policy "follows_insert_own"
  on public.follows for insert
  with check (auth.uid() = follower_id);

drop policy if exists "follows_delete_own" on public.follows;
create policy "follows_delete_own"
  on public.follows for delete
  using (auth.uid() = follower_id);

-- ================================================================= post_likes
-- One like per (user, post). Posts carry denormalized likes_count; the UI
-- recalculates it after any change.
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
create policy "post_likes_select_public"
  on public.post_likes for select
  using (true);

drop policy if exists "post_likes_insert_own" on public.post_likes;
create policy "post_likes_insert_own"
  on public.post_likes for insert
  with check (auth.uid() = user_id);

drop policy if exists "post_likes_delete_own" on public.post_likes;
create policy "post_likes_delete_own"
  on public.post_likes for delete
  using (auth.uid() = user_id);

-- ================================================================ saved_posts
-- Private bookmarks — RLS restricts selects to the owner.
create table if not exists public.saved_posts (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default timezone('utc'::text, now()),
  primary key (post_id, user_id)
);

create index if not exists saved_posts_user_idx on public.saved_posts (user_id, created_at desc);

alter table public.saved_posts enable row level security;

drop policy if exists "saved_posts_select_own" on public.saved_posts;
create policy "saved_posts_select_own"
  on public.saved_posts for select
  using (auth.uid() = user_id);

drop policy if exists "saved_posts_insert_own" on public.saved_posts;
create policy "saved_posts_insert_own"
  on public.saved_posts for insert
  with check (auth.uid() = user_id);

drop policy if exists "saved_posts_delete_own" on public.saved_posts;
create policy "saved_posts_delete_own"
  on public.saved_posts for delete
  using (auth.uid() = user_id);

-- ================================================== storage: avatars / banners
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('banners', 'banners', true)
on conflict (id) do nothing;

-- Public read for both buckets (profile imagery is public by design).
drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "banners_public_read" on storage.objects;
create policy "banners_public_read"
  on storage.objects for select
  using (bucket_id = 'banners');

-- Owner-scoped writes/updates/deletes, path-prefixed with auth.uid().
drop policy if exists "avatars_owner_write" on storage.objects;
create policy "avatars_owner_write"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "avatars_owner_update" on storage.objects;
create policy "avatars_owner_update"
  on storage.objects for update
  using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "avatars_owner_delete" on storage.objects;
create policy "avatars_owner_delete"
  on storage.objects for delete
  using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "banners_owner_write" on storage.objects;
create policy "banners_owner_write"
  on storage.objects for insert
  with check (bucket_id = 'banners' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "banners_owner_update" on storage.objects;
create policy "banners_owner_update"
  on storage.objects for update
  using (bucket_id = 'banners' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "banners_owner_delete" on storage.objects;
create policy "banners_owner_delete"
  on storage.objects for delete
  using (bucket_id = 'banners' and auth.uid()::text = (storage.foldername(name))[1]);
