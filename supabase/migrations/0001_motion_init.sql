-- ===========================================================================
-- Motion · initial schema
-- Run in Supabase SQL Editor (or `supabase db push`).
-- Safe to re-run: idempotent CREATE IF NOT EXISTS / CREATE OR REPLACE.
-- ===========================================================================

-- ---------------------------------------------------------------- profiles --
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null unique,
  full_name   text,
  avatar_url  text,
  bio         text,
  created_at  timestamptz not null default timezone('utc'::text, now())
);

-- ------------------------------------------------------------------- posts --
create table if not exists public.posts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  content       text not null,
  media_url     text,
  likes_count   int  not null default 0,
  reposts_count int  not null default 0,
  replies_count int  not null default 0,
  created_at    timestamptz not null default timezone('utc'::text, now())
);

-- --------------------------------------------- automated profile creation --
-- Seeds public.profiles whenever a user registers via Supabase Auth.
-- username: metadata.username -> email local-part fallback -> "user_<id>"
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_username text;
begin
  new_username := coalesce(
    nullif(new.raw_user_meta_data->>'username', ''),
    split_part(new.email, '@', 1),
    'user_' || left(new.id::text, 8)
  );

  insert into public.profiles (id, username, full_name)
  values (new.id, new_username, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;

  -- Unique violation from a duplicate username: fall back to a suffix.
  exception when unique_violation then
    insert into public.profiles (id, username, full_name)
    values (
      new.id,
      new_username || '_' || left(new.id::text, 6),
      new.raw_user_meta_data->>'full_name'
    )
    on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -------------------------------------------------------------------- rls --
alter table public.profiles enable row level security;
alter table public.posts    enable row level security;

-- profiles: world-readable; only the owner can edit. -------------------------
drop policy if exists "profiles_select_public" on public.profiles;
create policy "profiles_select_public"
  on public.profiles for select
  using (true);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- posts: world-readable feed; owners insert/delete their own rows. -----------
drop policy if exists "posts_select_public" on public.posts;
create policy "posts_select_public"
  on public.posts for select
  using (true);

drop policy if exists "posts_insert_own" on public.posts;
create policy "posts_insert_own"
  on public.posts for insert
  with check (auth.uid() = user_id);

drop policy if exists "posts_delete_own" on public.posts;
create policy "posts_delete_own"
  on public.posts for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------- indexes --
create index if not exists posts_created_at_idx on public.posts (created_at desc);
create index if not exists posts_user_id_idx    on public.posts (user_id);
create index if not exists profiles_username_idx on public.profiles (username);

-- ----------------------------------------------- optional: updated_at touch --
-- Later migrations can add an updated_at column; this helper is ready now.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc'::text, now());
  return new;
end;
$$;
