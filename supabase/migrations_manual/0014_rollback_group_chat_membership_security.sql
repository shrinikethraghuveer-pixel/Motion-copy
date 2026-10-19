-- ============================================================================
-- 0014 ROLLBACK -- reverse the revised 0014 group-chat membership migration
--
-- STATUS: PROPOSAL ONLY. Run ONLY in a disposable, non-production test
-- environment to undo an applied 0014, and first re-verify the live catalog
-- still matches the recorded baseline (pg_policies for both tables, function
-- ACLs, relforcerowsecurity). This is NOT a harmless production operation;
-- production rollback is an incident-response decision requiring explicit
-- human sign-off.
--
-- WARNING — running this rollback reintroduces BOTH vulnerabilities:
--   1. Restored "Authenticated users can create group chats" again lets ANY
--      authenticated user create a group_chats row directly, bypassing the
--      creation RPC (orphan groups return).
--   2. Restored "Group admins/creators can add members" again lets ANY
--      authenticated user insert membership rows into ARBITRARY groups —
--      self-join and adding others with the broad `auth.role()` check.
--
-- Reverses every artifact of revised 0014, in dependency order (both policies
-- restored BEFORE the functions they reference; functions dropped last so no
-- dangling policy references remain):
--   * group_members INSERT policy  -> verified live original (exact name/expression)
--   * group_chats restrictive block -> verified live original (exact name/expression)
--   * create_group_chat_with_members() -> dropped
--   * is_current_user_group_admin()    -> dropped
-- PRESERVES (untouched, as in 0014): "Users can view groups they belong to"
-- and "Users can view members of their groups" (both SELECT), and 0013's
-- helper public.is_current_user_group_member(uuid).
-- ============================================================================

begin;

-- 1. Restore the verified live membership INSERT policy (VULNERABLE — see
--    warning above). Exact name and expression from the 2026-10-17 capture
--    (pg_get_expr-normalized ::text cast included to byte-match the capture).
DROP POLICY "Group admins/creators can add members" ON public.group_members;
CREATE POLICY "Group admins/creators can add members"
  ON public.group_members
  AS permissive
  FOR INSERT
  TO public
  WITH CHECK (auth.role() = 'authenticated'::text);

-- 2. Remove the restrictive direct-insert block and restore the verified live
--    creation policy (VULNERABLE — see warning above), exact name/expression.
DROP POLICY "group_chats_insert_direct_blocked" ON public.group_chats;
CREATE POLICY "Authenticated users can create group chats"
  ON public.group_chats
  AS permissive
  FOR INSERT
  TO public
  WITH CHECK (auth.role() = 'authenticated'::text);

-- 3. Drop the 0014 functions. Order matters: both policies above are already
--    dropped, so nothing references the helper when it goes.
DROP FUNCTION public.create_group_chat_with_members(text, text, text, uuid[]);
DROP FUNCTION public.is_current_user_group_admin(uuid);

COMMIT;

-- Post-rollback checks (see docs/group-chat-membership-security-verification.md):
-- * pg_policies on both tables matches the 2026-10-17 captured baseline
--   byte-for-byte (names, roles, USING/WITH CHECK expressions).
-- * Both 0014 functions are absent; no dangling policy references.
-- * Both SELECT policies and 0013's helper still exist with original grants.
-- * The rollback is transaction-protected (single BEGIN/COMMIT): a mid-flight
--   failure leaves the applied-0014 state intact.
