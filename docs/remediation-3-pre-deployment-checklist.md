# Pre-deployment checklist — Remediation 3 (P3–P8) + pending Supabase migrations

Status legend: [ ] not done | [~] mechanical step, needs executor | [x] done & verified locally where possible.

App-level fixes in this pass shipped as normal code changes (covered by the regression suites named in the final report). Everything marked Supabase below can only be truly verified against a live project.

## 0. Source of truth and fresh-init precondition matrix

**Migrations 0012–0017 are the authoritative source of truth for schema changes.** `supabase/schema.sql` is the PRE-CHAIN baseline: a fresh database initialized from it must be able to replay 0012→0017 in order. It is not a post-migration snapshot and must not be applied on top of an already-migrated database. Live databases are NOT assumed to match either artifact — the re-capture/drift-diff (§1 items 1–2) governs the live path.

Every policy body below the line "byte-for-byte from the rollback capture" is copied from the capture-derived rollback files, which are the only repository artifacts claiming to record live policy text. They remain capture-based ASSUMPTIONS until §1's re-capture proves them.

Starting state each migration expects from the fresh baseline (all present in `supabase/schema.sql` as of the Stage-1 baseline edit):

| Migration | Expects from baseline | Baseline location |
|---|---|---|
| 0012 | posts columns incl. `audience_scope character varying` | schema.sql comments block + column adds (:60–73) |
| 0013 | `group_members` SELECT "Users can view members of their groups" (recursive body); messages INSERT policies "Users can send messages" + "Users can send DM or group messages" | schema.sql :384–400, :434–460 |
| 0014 | `group_members` INSERT "Group admins/creators can add members"; `group_chats` INSERT "Authenticated users can create group chats"; both 0014 functions absent | schema.sql :369–374, :401–406 |
| 0015 | NO `search_discoverable_profiles` function (bare CREATE in the migration fails if it pre-exists) | schema.sql :580–583 NOTE — function intentionally absent |
| 0016 | `post_likes_select_public` (using true); `post_like_counts` absent | schema.sql :234–235 (unchanged; already matched) |
| 0017 | post-0014 state (`create_group_chat_with_members` exists at 0014's signature) | reached by replaying 0014 first |

Known baseline vs live ambiguity (do not resolve by guessing):
- The live group_chats SELECT/UPDATE and group_members DELETE policies are never touched by 0012–0017. The baseline keeps the repository names (`group_chats_select_members`, `group_chats_update_admin`, `group_members_delete_own`); whether these byte-match live names is UNVERIFIED and must come from the §1 re-capture before assuming parity.
- `supabase/schema.sql` retains both poll/event column families (`event_details`/`poll_details` from 0008-era and `poll_data`/`event_data` from the live capture). Which family live tables actually use is UNVERIFIED; 0012 adds only the `*_data` family as a no-op.

Fresh-init replay (schema.sql + 0012–0017) is NOT yet machine-verified — that is Stage 2. Do not initialize anywhere but a disposable environment until Stage 2 passes.

## 1. Migration application order (apply only after re-capture)

1. [ ] Re-capture the full live catalog: `pg_policies` (all tables), `pg_proc` for all `public.*` functions + ACLs, `pg_class.relowner` and `relforcerowsecurity` for profiles, posts, post_likes, group_chats, group_members, messages, user_settings, user_blocks, user_mutes, saved_posts.
2. [ ] Diff the capture against the baselines embedded in the migration headers (0013/0014/0015/0016/0017 each list what they assume). Abort on drift; re-derive instead of editing policy bodies blind.
3. [ ] Apply **0012** (needs no helper; consolidates posts SELECT policy; column adds are no-ops live).
4. [ ] Apply **0013** (recursion-safe group_members SELECT helper + messages INSERT consolidation). Depends on nothing new live.
5. [ ] Apply **0014** (`create_group_chat_with_members` RPC + admin-only membership INSERT + RESTRICTIVE insert-block on group_chats).
6. [ ] Apply **0015** (`search_discoverable_profiles` RPC for browser search/suggested).
7. [ ] Apply **0016** (post_likes owner-only SELECT + `post_like_counts` RPC). **0016 and the client count change must land together — the client switch is ALREADY in the code (src/lib/db/profiles.ts postLikeCount RPC-first with legacy fallback)**, so 0017 can deploy after 0016 with zero client redeploy dependency. Still verify live:
   - [ ] Toggle a like as a viewer and confirm the count updates through `post_like_counts` (not a degenerate own-row count).
   - [ ] Product decision recorded BEFORE 0016 lands: behavior of an-other-user "Likes" tab under owner-only likes (empty list + label vs. tab removal). The legacy head-count fallback keeps the tab broken-but-harmless either way.
   - [ ] 0016 Part B (poll/events identity redaction) stays DEFERRED until the live write-path capture happens; the trigger template is commented out on purpose. CONFIRMED AUDIT RESULT (2026-10-18): no browser query reads `poll_data`/`event_data` jsonb (grep across src: only `posts.id, content, media_url, likes_count, reposts_count, replies_count, created_at` plus joined profiles) — the gap is direct-crafted-client access only, not UI breakage. Product decision could change this at any commit; re-grep before applying anything that touches those columns.
8. [ ] Apply **0017** (after 0014): block/deactivation governance for `create_group_chat_with_members` + admin-only `invite_group_members` RPC. The browser `addGroupMembers` path already prefers the RPC and falls back only when the function is missing.
   - [ ] **PRODUCT DECISION (unresolved, blocking 0017)**: fail-loudly vs. silently-filter invites that are blocked/deactivated. The app plane silently skips + returns 403 with handles; 0017 proposes failing the WHOLE call with a clear error. Must be decided by product before applying; the rollback restores 0014 bodies either way.
   - [ ] Group-size cap stays out of the DB plane (0014's recorded decision); the app plane enforces 20.
   - [ ] Confirm error message codes (42501 with explicit messages) surface correctly through the browser client's thrown Error.message.
9. [ ] After 0012–0017: re-capture once more and archive next to this checklist, noting applied-at timestamps and any drift found mid-sequence.

## 2. Post-application verification (live Supabase project)

- [ ] Run docs/posts-rls-verification.sql equivalents against 0012 (anon reader, non-connected private-profile reader, blocked pair, muted author, group audience scopes).
- [ ] As anon: `select count(*) from public.post_likes` → 0 under 0016; as authenticated: own rows only.
- [ ] `select * from post_like_counts('{<post uuid>}')` as owner as well as a different viewer, matching.
- [ ] 0014 negative tests as a browser-authenticated user (not service key): direct INSERT into group_chats fails; direct INSERT into group_members outside an admin membership fails; RPC creates rows atomically (verify an invalid invitee rolls back the chat row).
- [ ] 0015 RPC: anon gets 0 rows; blocked pairs absent; viewer absent; undeactivated + discovery-default rows match local search behavior.
- [ ] 0017 negative tests: invitee blocked with creator fails the WHOLE create (group row absent after failure); deactivated invitee fails; invite_group_members as non-admin fails; as admin succeeds and reports the correct added-count.
- [ ] The documented MOTION_TRUSTED_RL_HEADER requirement (rate-limit identity is platform-controlled) is acknowledged by whoever runs any non-Vercel deployment: without a trusted header the whole deployment shares per-actor buckets; `!none` disables the shared-IP split.

## 3. Known parity gaps (accepted, documented — not "done" items)

- [ ] Local JSON-mode tests cover app-plane redaction (P7), bounds (P8), governance (P3), throttles (P4) on the legacy store ONLY. Supabase-plane equivalents need live verification of every browser query against tightened policies (esp. any direct `.select()` of user_settings, poll_data, event_data, or other users' post_likes).
- [ ] ~~`create_group_chat_with_members` (0014) does not yet carry the app-plane screening/block checks~~ → superseded by **0017** (pending the fail-loudly product decision above). Until 0017 applies: the Supabase create path respects admin-gating but NOT block governance; the browser `addGroupMembers` fallback also skips block checks (pre-0014/0017 live policy anyway permits member gates it replaces — no regression, just no improvement until the RPC exists).
- [ ] Migration chain (0012–0017) must ALSO be re-reviewed against supabase/schema.sql drift — schema.sql still carries the pre-0016 post_likes policy text after a rollback or fresh init.

## 4. Runtime configuration

- [ ] `MOTION_ADMIN_EMAILS` set for admin queue access (mail regex check happens per request; no default admin exists).
- [ ] `MOTION_BLOCKED_TERMS` if org-specific screening terms are wanted beyond the three built-in abuse rules.
- [ ] `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` for production throttling (fail-closed without them in production — 503-style denies, not open service).
- [ ] Vercel: nothing extra needed (x-forwarded-for is platform truth). Non-Vercel: set MOTION_TRUSTED_RL_HEADER to the platform-injected header or buckets collapse to "unknown".
