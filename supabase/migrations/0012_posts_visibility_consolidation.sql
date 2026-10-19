-- Group A: consolidate post visibility into a single permissive SELECT policy.
--
-- Problem: the live posts table carries an out-of-band policy
--   "Enforce community audience scope on post reads" (TO authenticated)
-- that OR-combines with posts_select_visible, letting any authenticated user
-- bypass profile privacy, blocks, deactivation, and viewer mutes.
--
-- Product rules implemented here (all confirmed):
--   * NULL audience_scope  -> hidden from everyone, including the author.
--   * 'Everyone' + no group -> readable by anonymous and authenticated viewers
--                              (subject to profile visibility + viewer mute).
--   * 'Everyone' + group    -> members of that group only.
--   * 'Community Only' / 'Members Only' -> members of the associated group.
--   * Unknown values        -> denied.
--   * Private profiles respect can_view_profile (accepted-connection rule).
--   * Blocks in either direction deny visibility.
--   * Viewer mutes hide posts but never profiles.
--   * Deactivated authors' posts stay hidden from everyone but the author.
--
-- Scope matching is case-insensitive: the application writes 'Everyone' /
-- 'Community Only' / 'Members Only' (title case) while earlier manual policy
-- work used lowercase; both conventions are accepted, everything else denied.

-- The five columns below exist on the current live database (added out-of-band)
-- but are absent from migrations 0001-0011. Declaring them here makes the
-- migration chain self-sufficient on a fresh database: the consolidated policy
-- that follows references audience_scope and group_id. `add column if not
-- exists` is a no-op against the live database, so existing columns (including
-- any rows and values already present) are never touched or overwritten.
-- audience_scope uses character varying to match the live column type exactly.
alter table public.posts
  add column if not exists audience_scope character varying,
  add column if not exists gif_url text,
  add column if not exists poll_data jsonb,
  add column if not exists event_data jsonb,
  add column if not exists group_id uuid;

-- ============================================================================
-- Direct messages + group chats 'live baseline' restored here so this chain is
-- self-sufficient. The live database carried these objects as out-of-band
-- schema (they lived in supabase/schema.sql only, not in any migration), but
-- this policy below references public.group_members, and migrations 0013 /
-- 0014 tighten policies that must already exist by name:
--   0013 drops "Users can view members of their groups",
--        "Users can send messages", "Users can send DM or group messages".
--   0014 drops "Group admins/creators can add members",
--        "Authenticated users can create group chats".
-- Every statement below is byte-for-byte/verbatim from supabase/schema.sql
-- lines 289-471 (the captured pre-0013 live state, itself restored from the
-- 0013/0014 rollback captures). All idempotent; on the live database the
-- create-table/alter-column statements are no-ops and policies are recreated
-- with identical definitions. No rows are touched.
--
-- KNOWN-BUG NOTE (documented, NOT silently changed here — this file restores
-- the captured state faithfully): the baseline "group_members_delete_own"
-- (below) and "messages_select_participants" (widened below) contain bare
-- `group_id` references inside their `group_members gm` subqueries, which
-- normalize to `gm.group_id = gm.group_id` (always true). Migration 0018
-- re-creates both policies with qualified outer references.
-- ============================================================================

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
-- 0014 REPLACES this policy with the restrictive direct-insert block.
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
-- 0013 REPLACES this policy with the non-recursive helper check.
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
    or exists (select 1 from public.group_members gm where gm.group_id = group_id and gm.user_id = auth.uid() and gm.role = 'admin'));

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
    or (group_id is not null and exists (
      select 1 from public.group_members gm where gm.group_id = group_id and gm.user_id = auth.uid()
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

-- ============================================================================

drop policy if exists "Enforce community audience scope on post reads" on public.posts;

drop policy if exists "posts_select_public" on public.posts;
drop policy if exists "posts_select_visible" on public.posts;
create policy "posts_select_visible" on public.posts
  for select
  to public
  using (
    -- Public posts: 'Everyone' with no group. NULL scope fails closed because
    -- lower(NULL) is NULL and the equality is not true.
    (
      lower(posts.audience_scope) = 'everyone'
      and posts.group_id is null
      and public.can_view_profile(posts.user_id, auth.uid())
      and not exists (
        select 1 from public.user_mutes m
        where m.muter_id = auth.uid() and m.muted_id = posts.user_id
      )
    )
    or
    -- Group posts: 'Everyone' with a group, 'Community Only', or 'Members Only'.
    -- Membership is required; anonymous viewers (auth.uid() = null) never match.
    (
      posts.group_id is not null
      and lower(posts.audience_scope) in ('everyone', 'community only', 'members only')
      and exists (
        select 1 from public.group_members gm
        where gm.group_id = posts.group_id and gm.user_id = auth.uid()
      )
      and public.can_view_profile(posts.user_id, auth.uid())
      and not exists (
        select 1 from public.user_mutes m
        where m.muter_id = auth.uid() and m.muted_id = posts.user_id
      )
    )
  );

-- Insert and delete policies (posts_insert_own, posts_delete_own from 0001)
-- are intentionally untouched. No foreign key is added to posts.group_id.
