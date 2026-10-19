-- ============================================================================
-- 0016 -- Keep interaction identities private on the Supabase plane
--
-- STATUS: PROPOSAL ONLY. Not applied. See the rollback file and the
-- pre-deployment checklist for review/verification steps.
--
-- PROBLEM (audit finding P7, Supabase plane):
--   Part A: public.post_likes carries "post_likes_select_public" with
--   using (true) (supabase/schema.sql:235, 0003:71). Any anon/authenticated
--   client can read EVERY user's like rows. That is not "who liked what"
--   counts — it is second-order identity data: a user's full like history
--   (and who-liked-this-post adjacency), exactly the class of identity list
--   the server plane stopped emitting (server.ts redactPostForViewer).
--
--   Part B: public.posts.poll_data / event_data (jsonb, 0012) store raw
--   `votes: string[]` (poll options) and `attendee_ids: string[]` (events).
--   Any client that can SELECT the post can read those voter/attendee ID
--   arrays directly, regardless of application-plane redaction.
--
-- WHY PART A IS READY NOW:
--   The current browser client (src/lib/db/profiles.ts, src/lib/db/posts.ts)
--   only ever reads post_likes with (a) eq("user_id", viewer),
--   (b) count-only heads for counts, and (c) eq("user_id", <profile owner>)
--   for that owner's Likes tab. Under the tightened policy (own rows only)
--   (a) and (b) behave identically; (c) still works when the viewer IS the
--   profile owner and returns an empty list otherwise.
--
-- BEHAVIORAL IMPACT (needs product sign-off, listed in the checklist):
--   * Viewing ANOTHER profile's "Likes" activity tab returns an empty list
--     (their like rows are no longer readable by anyone but themselves).
--   * Aggregate counts are unaffected (count/head endpoints only need the
--     count, but note: a COUNT over restricted rows returns only allowed
--     rows!). This is the one true breakage: like counts computed as
--     `.select("*", { count: "exact", head: true }).eq("post_id", ...)` will
--     now count ONLY the viewer's own like row (at most 1).
--
--   The count breakage MUST be fixed in the same deployment, not later. Part
--   C adds a SECURITY DEFINER counts RPC that returns only counts (no user
--   ids), and the accompanying checklist has the companion app change.
--
--   Alternative kept open: a per-post visibility joining likes→posts under
--   posts_select_visible; rejected for now because like rows would then
--   inherit profile-privacy linkage and the "is this post visible to me"
--   predicate duplication is easy to get wrong.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Part A: likes are owner-private. Everyone still HAS the table; only own
-- rows are readable. Insert/delete policies are unchanged.
-- ---------------------------------------------------------------------------
drop policy if exists "post_likes_select_public" on public.post_likes;
create policy "post_likes_select_own" on public.post_likes
  for select
  to public
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Part C: identity-free interaction counts.
--   * Post functions: no auth.uid() argument; the subject is always the
--     caller. SECURITY DEFINER avoids the tightened post_likes policy
--     (owner bypass; FORCE RLS verified false in 2026-10-17 capture —
--     RE-CAPTURE before applying, per checklist).
--   * Returns ONLY counts ± flags. It never returns other users' ids.
--   * polled self_vote/has_voted arrives through the caller's own rows.
-- ---------------------------------------------------------------------------
create function public.post_like_counts(p_post_ids uuid[])
returns table (post_id uuid, like_count bigint)
language sql
stable
security definer
set search_path = ''
as $fn$
  select l.post_id, count(*)::bigint
  from public.post_likes l
  where l.post_id = any (coalesce(p_post_ids, '{}'::uuid[]))
  group by l.post_id
$fn$;

alter function public.post_like_counts(uuid[]) owner to postgres;
revoke execute on function public.post_like_counts(uuid[]) from public;
grant execute on function public.post_like_counts(uuid[]) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Part B: poll_data / attendee_ids redaction — DEFERRED TEMPLATE ONLY.
--   The polls/events data flow (who writes votes/attendee_ids, which RPCs
--   exist live, which browser paths select poll_data/event_data) was NOT
--   fully captured yet; changing or stripping the jsonb keys without that
--   capture risks silently breaking voting/RSVP in production. Template
--   (commented; NOT executed by this migration): a write-time trigger that
--   keeps per-option vote counts and the caller's own vote in poll_data but
--   stores identity arrays in a companion owner-only table.
--
--   Do NOT apply until: (1) the live poll/event write paths are captured
--   (pg_proc + which keys the app reads/writes); (2) the app change to read
--   counts from the new shape is deployed atomically with the trigger.
--
-- create or replace function public.redact_interaction_identity()
-- returns trigger
-- language plpgsql
-- security definer
-- set search_path = ''
-- as $fn$
-- begin
--   if new.poll_data is not null then
--     new.poll_data := jsonb_set(new.poll_data, '{voted_ids}', '[]'::jsonb, true);
--   end if;
--   if new.event_data is not null then
--     new.event_data := jsonb_set(new.event_data, '{attendee_ids}', '[]'::jsonb, true);
--   end if;
--   return new;
-- end;
-- $fn$;
--
-- create trigger posts_redact_identity
--   before insert or update on public.posts
--   for each row execute function public.redact_interaction_identity();
-- ============================================================================

commit;

-- Review before execution:
-- * RE-CAPTURE the live catalog immediately before applying (pg_policies on
--   post_likes, pg_class.relowner/relforcerowsecurity, pg_proc for the names
--   used here) and diff against the 2026-10-17 baseline; abort on drift.
-- * The client ALREADY prefers post_like_counts (src/lib/db/profiles.ts
--   postLikeCount, RPC-first with head-count fallback), so applying this
--   migration alone no longer degrades public like counts. Verify live after
--   applying, and only remove the fallback head-count once the RPC is live.
-- * The "Likes" activity tab behavior for other-people profiles is a
--   product decision (empty list + UI label vs. removal); record it first.
