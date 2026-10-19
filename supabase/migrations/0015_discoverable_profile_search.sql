-- ============================================================================
-- 0015 -- Enforce campus-discovery, blocking, deactivation, and auth rules for
-- client-side profile search
--
-- STATUS: PROPOSAL ONLY. Not applied. Recapture the live catalog
-- (pg_policies, pg_proc, relowner, relforcerowsecurity) immediately before
-- applying and abort on drift.
--
-- PROBLEM (audit finding P1, implemented on the server plane today):
--   The browser client queries public.profiles directly for user search
--   (src/lib/dm-backends.ts searchUsers) and the Supabase branch of
--   /api/users/suggested does the same (src/app/api/users/suggested/route.ts).
--   The matching server-side behavior (src/app/api/users/search/route.ts and
--   the local fallback of both routes) additionally requires:
--     * campus_discovery = true (user discoverability toggle), which lives in
--       user_settings — owner-only by RLS, so NO browser query can honor it;
--     * exclusion of the viewer themself from search results;
--     * a signed-in caller (requireUser on every local search route).
--   can_view_profile / profiles_select_visible already enforce blocking (both
--   directions), deactivation, and private-profile gating for direct profile
--   access; discovery is a search-listing rule, NOT a profile-access rule
--   (local /api/users/[handle] serves non-discoverable profiles to direct
--   navigation). Therefore the filter belongs in a dedicated search helper,
--   not in can_view_profile.
--
-- RULES IMPLEMENTED HERE (established, matching src/app/api/users/search):
--   * Caller must be authenticated (anon always gets zero rows).
--   * The viewer is never included in their own search results.
--   * campus_discovery defaults to true when no user_settings row exists.
--   * Deactivated profiles are excluded (matches can_view_profile).
--   * Blocks in either direction exclude the pair (both directions match the
--     established server rule — a viewer who blocked someone must not see
--     them in search, exactly as user/search/route.ts:23 does).
--   * Private-but-discoverable profiles REMAIN searchable: local
--     /api/users/search lists them (only their content is gated).
--   * Unrecognized search text wildcards are the caller's disposal; the
--     browser client already strips % and _ before calling (dm-backends).
--
-- EXPOSURE BOUNDARY: the RPC returns only id, username, full_name,
-- display_name, avatar_url. It does NOT expose bio, phone, school, or any
-- user_settings fields, and order/limit are clamped server-side.
--
-- CREATED via plain CREATE (not OR REPLACE): if a function with this
-- signature already exists live, applying fails with ERROR duplicate
-- function — deliberate fail-stop, same stategy as migration 0014.
-- ============================================================================

begin;

create function public.search_discoverable_profiles(
  p_search_text text default '',
  p_result_limit integer default 10
)
returns table (
  id uuid,
  username text,
  full_name text,
  display_name text,
  avatar_url text
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select p.id, p.username, p.full_name, p.display_name, p.avatar_url
  from public.profiles p
  left join public.user_settings s on s.user_id = p.id
  where
    auth.uid() is not null
    and p.id <> auth.uid()
    and coalesce(s.campus_discovery, true)
    and not p.is_deactivated
    and not exists (
      select 1
      from public.user_blocks b
      where (b.blocker_id = p.id and b.blocked_id = auth.uid())
         or (b.blocker_id = auth.uid() and b.blocked_id = p.id)
    )
    and (
      p.username ilike '%' || p_search_text || '%'
      or p.full_name ilike '%' || p_search_text || '%'
    )
  order by p.created_at desc
  limit least(greatest(coalesce(p_result_limit, 10), 1), 30)
$fn$;

alter function public.search_discoverable_profiles(text, integer) owner to postgres;
revoke execute on function public.search_discoverable_profiles(text, integer) from public;
revoke execute on function public.search_discoverable_profiles(text, integer) from anon;
grant execute on function public.search_discoverable_profiles(text, integer) to authenticated;

commit;

-- Review before execution:
-- * The live profiles table still has the columns referenced here (id,
--   username, full_name, display_name, avatar_url, is_deactivated,
--   created_at) and user_settings.campus_discovery exists (0004/0011).
-- * No other function named search_discoverable_profiles(text, integer)
--   exists live (CREATE fails loudly if this drifts).
-- * profiles rows are owned by postgres with FORCE RLS false only where the
--   2026-10-17 capture showed so; this function reads profiles via SECURITY
--   DEFINER and evaluates block/deactivation truth against real rows, so
--   only the campus_discovery join relies on the owner RLS bypass — flag any
--   relforcerowsecurity = true drift before applying.
