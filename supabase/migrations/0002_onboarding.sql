-- ===========================================================================
-- Motion · onboarding fields
-- Adds the onboarding questionnaire columns to public.profiles.
-- Run in Supabase SQL Editor AFTER 0001_motion_init.sql.
-- ===========================================================================

alter table public.profiles
  add column if not exists age int,
  add column if not exists interests text[] not null default '{}',
  add column if not exists goal text,
  add column if not exists feed_vibe text,
  add column if not exists onboarding_completed boolean not null default false;

-- Optionally widen username length rules later; nothing else to change:
-- RLS from 0001 still governs access (public read, owner-only write).
