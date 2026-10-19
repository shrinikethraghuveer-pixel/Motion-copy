-- ============================================================================
-- 0016 ROLLBACK — restore the pre-0016 interaction-plane state
-- (mirrors the shape of 0013/0014/0015 rollbacks; mirrors schema.sql:235)
--
-- STATUS: PROPOSAL ONLY.
-- ============================================================================

begin;

-- Post_likes SELECT: back to fully public rows (schema.sql:235 baseline).
drop policy if exists "post_likes_select_own" on public.post_likes;
create policy "post_likes_select_public" on public.post_likes
  for select using (true);

-- Counts RPC: removed with the feature.
drop function if exists public.post_like_counts(uuid[]);

-- No table or column objects were created or altered by 0016; jsonb
-- poll_data/event_data redaction (Part B) was intentionally NOT executed.

commit;
