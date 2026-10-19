# Group-chat membership security verification (0014)

`0014_group_chat_membership_security.sql` is a proposal. Do not run it or its
rollback against production. Run all checks in a disposable, non-production
environment first, using disposable auth users. This document is a test plan,
not an executed result — nothing here claims the migration has been applied
or tested.

`leaveGroup()` DELETE authorization and any final-admin rule are explicitly
out of scope: 0014 adds no DELETE policy, and creating one is not part of this
migration. Decide and ship that separately.

## Verified live baseline (capture: Supabase SQL Editor, 2026-10-17)

Recorded facts that migration 0014 and its rollback rely on. Treat them as
evidence of one point in time — the live database may have changed since.

| Table | Owner | RLS | FORCE RLS |
|---|---|---|---|
| `public.group_chats` | `postgres` | enabled | false |
| `public.group_members` | `postgres` | enabled | false |
| `public.messages` | `postgres` | enabled | false |

Policies live at capture (the only ones returned for these two tables):

- `group_chats` — "Authenticated users can create group chats" (PERMISSIVE,
  INSERT, `TO {public}`, `WITH CHECK (auth.role() = 'authenticated'::text)`)
  → replaced by 0014. "Users can view groups they belong to" (PERMISSIVE,
  SELECT) → preserved, untouched.
- `group_members` — "Group admins/creators can add members" (PERMISSIVE,
  INSERT, `TO {public}`, `WITH CHECK (auth.role() = 'authenticated'::text)`)
  → replaced by 0014. "Users can view members of their groups" (PERMISSIVE,
  SELECT, `USING (is_current_user_group_member(group_id))`) → preserved,
  untouched (0013 helper policy).

Function facts: `public.is_current_user_group_member(uuid)` exists (owner
`postgres`, SECURITY DEFINER, empty `search_path`, EXECUTE for
anon/authenticated/service_role) — the 0013 helper, untouched. Neither
`is_current_user_group_admin(uuid)` nor
`create_group_chat_with_members(text,text,text,uuid[])` existed at capture.
Constraints: `group_members_role_check` (admin/member),
`group_members_group_id_user_id_key` UNIQUE, FKs `ON DELETE CASCADE` to
`group_chats.id` and `auth.users.id`; `group_chats.created_by` FK CASCADE.

## Mandatory pre-apply capture (re-verification, not assumption)

Immediately before applying, capture and diff against the baseline above:

- `pg_policies` for both tables — confirm exactly one permissive INSERT
  policy exists on `group_members` (only that one is replaced; an extra
  permissive INSERT policy discovered here is STOP condition, since 0014
  installs no restrictive backstop on `group_members` — its allow path is
  value-dependent and not expressible as a static false check).
- `pg_class.relowner` and `relforcerowsecurity` for `group_chats` and
  `group_members` — must still be `postgres` / `false`, the anchor for the
  SECURITY DEFINER helper/RPC bypassing RLS. If FORCE RLS appears, STOP:
  the helper would re-enter policy evaluation and the migration must be
  redesigned.
- `pg_proc`/`pg_get_functiondef` and function ACLs: neither 0014 function
  already exists (0014 uses `create function`, not OR REPLACE, and aborts on
  collision); 0013 helper unchanged.

## Positive cases

1. **RPC creation with invitees.** As `authenticated` A, call
   `create_group_chat_with_members` with B and C. One UUID returned; exactly
   one `group_chats` row with `created_by = A`; exactly one `(A, 'admin')`
   row; `(B, 'member')` and `(C, 'member')` rows; nothing else.
2. **Duplicate invitees.** Array `['B','B','C']` still yields one member row
   per user (`select distinct` + the verified UNIQUE constraint).
3. **Creator listed as invitee.** Array `['A','B']` yields only the single
   `(A, 'admin')` row — no second `(A, 'member')` row (`<> v_caller_id`).
4. **NULL and empty arrays.** `p_member_ids = NULL` and `'{}'` both create
   the group plus only the caller's admin row.
5. **Invitee roster visibility.** B and C can immediately read the group row
   ("Users can view groups they belong to"), the roster
   ("Users can view members of their groups"), and the group's messages once
   members; non-members cannot read the group.
6. **Admin invite via direct INSERT.** As current admin A, inserting a
   `(D, 'member')` row directly succeeds (the intended admin path).
7. **RPC unaffected by the restrictive block.** The same `authenticated` user
   who is denied a direct `group_chats` INSERT (negative 5) succeeds through
   the RPC — owner + `FORCE RLS = false` bypass, NOT runtime-tested at
   authoring; this test is the runtime proof.

## Negative and atomicity cases

1. **Anon.** Cannot execute the RPC (no EXECUTE grant to `anon`/`public`),
   cannot insert into `group_members` or `group_chats`. Expected denial
   mechanism (established fact, see catalog checks): the membership INSERT
   policy is `TO authenticated`, so anon's plan never contains the helper
   expression — the fail mode is the standard RLS violation
   (`SQLSTATE 42501`, "violates row-level security policy"), NOT
   "permission denied for function ...". Disambiguating the exact client-visible
   message from a plan-time function-privilege error is disposable-database
   runtime evidence.
2. **Non-member / ordinary member.** Neither can insert any
   `group_members` row for groups they do not admin.
3. **Role escalation.** An admin cannot directly insert an `admin` row for
   self or others (policy requires `role = 'member'`).
4. **Bootstrap attempt.** No direct INSERT path can add a first member to an
   existing group — impossible without admin, impossible via creation
   (RPC-only).
5. **Direct `group_chats` INSERT blocked.** Any `authenticated` non-owner
   direct INSERT is rejected: with the live policy dropped, the RESTRICTIVE
   `WITH CHECK (false)` policy ANDs false into every permissive combination.
   This test also validates the NOT-runtime-tested OR/AND RLS argument in
   the migration comment.
6. **Invalid invitee atomicity.** RPC call with a nonexistent random UUID
   fails on the FK and leaves NEITHER the `group_chats` row NOR any
   membership row (including the caller's admin row) behind.
7. **No cross-call leakage.** After case 6, a successful creation produces
   the full expected state (no leaked rows from the failed attempt).

## Post-apply catalog checks

- Both new functions: owner `postgres`, `prosecdef = true`, `proconfig` pins
  `search_path=''`, all object references schema-qualified.
- EXECUTE: `authenticated` has it on both; `public`/`anon` do not. The
  narrower grant is sound: PostgreSQL evaluates policy-role applicability
  BEFORE planning the WITH CHECK expression, so a `TO authenticated`
  policy is not in anon's applicable policy set and its expression is
  never planned/evaluated for anon — no function-EXECUTE check can fire
  on this code path (role-privilege applicability is a policy-matching
  concern, distinct from plan-time EXECUTE checks that affect only roles
  for which the policy applies, as with the 0013 `TO public` SELECT
  policy whose helper IS granted to anon). Runtime re-verification of the
  anon denial type is still a disposable-database test.
- Policy definitions: membership policy = PERMISSIVE/INSERT/TO
  authenticated/`role = 'member' AND public.is_current_user_group_admin(group_id)`;
  `group_chats_insert_direct_blocked` = RESTRICTIVE/INSERT/TO public/
  `with check (false)`.
- Both preserved SELECT policies byte-identical to capture, and 0013's
  helper still present with its original anon/authenticated/service_role
  grants (0014 changes neither).
- `relforcerowsecurity` still `false` on `group_chats`/`group_members`.

## Rollback verification (disposable environment only)

1. Apply 0014, pass the positive set, then apply 0014's rollback — after
   re-verifying the live catalog against baseline.
2. Confirm both restored policies byte-match the 2026-10-17 capture: exact
   names "Authenticated users can create group chats" and "Group
   admins/creators can add members", PERMISSIVE/FOR INSERT/TO public/
   `WITH CHECK (auth.role() = 'authenticated'::text)`.
3. Confirm both 0014 functions are absent, with no dangling references, and
   that both preserved SELECT policies plus 0013's helper still exist.
4. Understand that this verifies the reintroduction of two documented
   vulnerabilities — any authenticated user can create groups directly and
   insert membership rows into arbitrary groups. Never describe rollback as
   safe in production; it is an incident-response decision with explicit
   human sign-off.
5. Transaction protection: single `BEGIN/COMMIT`; a mid-flight failure
   leaves the applied-0014 state intact.

## Application behavior on Supabase failure (code unchanged; observe only)

The app (`dm-backends.ts`) does not fall back to the legacy JSON APIs for
`createGroup`, `addGroupMembers`, `sendGroupMessage`, or `leaveGroup` in
Supabase mode. In the disposable environment, make an operation fail
(e.g. revoke EXECUTE on the RPC for the test user, or attempt the
not-your-group add) and observe: the UI surfaces the error; no JSON-store
write occurs; the Send box restores the draft; the Add Members panel keeps
its error and selection; Leave re-enables and the roster is unchanged.
Do not edit application code to make these tests pass — they verify the
already-shipped app-side behavior.

## Out of scope (decision pending)

`leaveGroup()` — the direct `group_members` DELETE — has no dedicated policy
in 0014. Before enabling it, make an explicit product decision for a final
admin: prohibit leaving until another admin exists, or define
ownership-transfer/deletion behavior. Any candidate policy must be reviewed
and shipped separately; 0014 must not gain a DELETE policy.
