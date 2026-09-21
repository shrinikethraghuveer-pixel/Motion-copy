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
  add column if not exists onboarding_completed boolean not null default false;

-- ====================================================================== posts
create table if not exists public.posts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  content       text not null,
  media_url     text,
  is_ai_generated boolean not null default false, -- feeds the "Groq AI Generated" badge
  ai_prompt       text,        -- prompt that produced this content, when AI-generated
  likes_count   int  not null default 0,
  reposts_count int  not null default 0,
  replies_count int  not null default 0,
  created_at    timestamptz not null default timezone('utc'::text, now())
);

-- ============================================================= ai_generations
-- Audit/history of every Groq completion, scoped strictly to its owner.
create table if not exists public.ai_generations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  prompt     text not null,
  response   text not null,
  model_used text not null default 'llama-3.3-70b-versatile',
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

  -- Unique violation from a duplicate username: retry with a suffix.
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

-- ======================================================================= rls --
alter table public.profiles       enable row level security;
alter table public.posts          enable row level security;
alter table public.ai_generations enable row level security;

-- profiles: world-readable; only the owner can edit their row. ---------------
drop policy if exists "profiles_select_public" on public.profiles;
create policy "profiles_select_public"
  on public.profiles for select
  using (true);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- posts: world-readable feed; owners insert/delete only their own rows. -------
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

-- ==================================================================== indexes
create index if not exists posts_created_at_idx  on public.posts (created_at desc);
create index if not exists posts_user_id_idx     on public.posts (user_id);
create index if not exists profiles_username_idx on public.profiles (username);
create index if not exists ai_generations_user_created_idx
  on public.ai_generations (user_id, created_at desc);
