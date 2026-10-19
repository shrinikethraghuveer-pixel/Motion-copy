-- ============================================================================
-- 0015 (rollback) — Remove the discoverable-profile search RPC
--
-- Undoes migration 0015_discoverable_profile_search.sql. Callers that rely on
-- the RPC (src/lib/dm-backends.ts searchUsers, the Supabase branch of
-- /api/users/suggested) fall back to their legacy JSON-store APIs when the
-- RPC is missing, so removal degrades gracefully instead of breaking pages.
--
-- Does not touch any policy, table, or other function.
-- ============================================================================

begin;

drop function if exists public.search_discoverable_profiles(text, integer);

commit;
