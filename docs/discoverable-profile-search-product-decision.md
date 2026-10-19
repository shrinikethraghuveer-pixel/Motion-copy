# Product Decision — Discoverable-Profile Search Boundary

**Status:** Intentional product behavior, implemented as migration
`supabase/migrations/0015_discoverable_profile_search.sql` (PROPOSAL ONLY —
not applied, production not verified). Migration-0015 apply requires the
live-catalog re-capture steps listed in its header.

## Decision

Private-but-discoverable profiles **may appear in search results** (the
`search_discoverable_profiles` helper and the local
`/api/users/search`/`/api/users/suggested` surfaces). Discovery listing
exposes only the fields required to start a connection or recognize a
person:

- `id`
- `username`
- `full_name`
- `display_name`
- `avatar_url`

## What this boundary does NOT authorize

- No access to private profile **content**: posts, saved items, likes
  activity, bio, phone, school, or any `user_settings` fields. Locked
  private profiles remain gated behind `can_view_profile`
  (`schema.sql` / migration 0011), which the posts policy
  `posts_select_visible` (migration 0012) also consults.
- No profile access for non-discoverable users beyond what
  `can_view_profile` already grants on direct navigation: discovery is a
  **search-listing** rule, not a profile-access rule.
- No anonymous access: `auth.uid()` is required; anon gets zero rows, and
  EXECUTE is revoked from `public`/`anon`, granted only to `authenticated`.
- Blocks in either direction and deactivated accounts are always excluded
  from search results, and users never appear in their own results.

## Accepted exposure

A non-connected viewer can enumerate handles/names/avatars of
private-but-discoverable users via search. This is required for the
product: connection requests to private accounts must be possible, which
proved impossible when `can_view_profile` alone governed search. The RPC
returns a strict column subset — it never widens direct-profile access.

## Verification caveat

No claim is made that production RLS matches this document. The
equivalent TypeScript policy-model tests in
`tests/regression-profile-visibility.test.ts` (mocked checks) pin the
intended semantics only. Confirm against a deployed Supabase project
before treating production as enforcing this boundary.
