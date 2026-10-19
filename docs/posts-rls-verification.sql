-- ============================================================================
-- posts_select_visible — transactional RLS verification (0012 policy)
--
-- SAFETY MODEL (read before running):
--   * The entire script is ONE explicit transaction. The ONLY cleanup is the
--     final ROLLBACK. There are NO DELETE statements of any kind.
--   * Any precondition failure, fixture collision, or failed assertion raises
--     an exception, which aborts the whole transaction — nothing can persist.
--   * Pre-existing user_mutes / user_blocks / user_settings rows are NEVER
--     inserted over, updated, or deleted — with ONE deliberate exception:
--     test3's existing settings row has is_private = true, so the test
--     TEMPORARILY updates it to false inside the transaction so test3 can
--     serve as the public-author fixture. The original value is restored by
--     the final ROLLBACK, including when an assertion fails (a failure raises
--     and aborts the same transaction). Nothing else about the row changes.
--   * Test rows use fixed UUIDs in a reserved range; every target table is
--     checked for collisions before any insert.
--   * Role switching uses transaction-local set_config('role', …) plus the
--     Supabase request.jwt.claims GUC, so auth.uid() impersonation lasts only
--     until the next set_config or the rollback.
-- ============================================================================

begin;

create temp table test_results (case_no text, ok boolean, detail text) on commit drop;

-- ---------------------------------------------------------------------------
-- phase 0: preconditions — every failure here aborts the transaction
-- ---------------------------------------------------------------------------
do $pre$
declare
  v_test3 uuid; v_nullp uuid; v_deact uuid;
  v_test3_settings_count int; v_test3_orig_private boolean;
  v_test3_has_settings boolean; v_null_has_settings boolean;
  v_null_is_private boolean;
  v_group_collides boolean;
  v_post_collides int;
begin
  select id into v_test3 from public.profiles where lower(username) = 'test3';
  -- The private-fixture profile has username IS NULL (a lookup on the string
  -- 'null' would match the wrong row or none), so it is PINNED to its exact
  -- UUID instead of being looked up by username. Its existence and its
  -- NULL username are both verified explicitly below.
  v_nullp := '0297ce79-83d2-4659-a24b-071fffdae0c2';
  if not exists (select 1 from public.profiles where id = v_nullp) then
    raise exception 'PRECONDITION: profile 0297ce79-83d2-4659-a24b-071fffdae0c2 (the NULL-username fixture) does not exist';
  end if;
  if (select username from public.profiles where id = v_nullp) is not null then
    raise exception 'PRECONDITION: profile 0297ce79-83d2-4659-a24b-071fffdae0c2 is expected to have username IS NULL';
  end if;
  select id into v_deact from public.profiles where lower(username) = 'shriniketh28';

  if v_test3 is null or v_nullp is null or v_deact is null then
    raise exception 'PRECONDITION: expected profiles test3 / null / shriniketh28 to all exist';
  end if;
  -- NULL-safe: is_deactivated IS TRUE rejects both false and NULL
  if (select is_deactivated from public.profiles where id = v_deact) is distinct from true then
    raise exception 'PRECONDITION: shriniketh28 expected to be deactivated (is_deactivated IS TRUE); got false or NULL';
  end if;
  -- the public-author fixture must be an ACTIVE profile
  -- NULL-safe: is_deactivated IS FALSE rejects both true and NULL
  if (select is_deactivated from public.profiles where id = v_test3) is distinct from false then
    raise exception 'PRECONDITION: test3 expected to be active (is_deactivated IS FALSE); got true or NULL';
  end if;

  -- fixture-group UUID must be unused
  select exists (
    select 1 from public.group_chats where id = 'b1000000-0000-0000-0000-000000000001'
  ) into v_group_collides;
  if v_group_collides then
    raise exception 'PRECONDITION: fixture group uuid already exists — refusing to proceed';
  end if;

  -- fixture-post UUIDs must be unused
  select count(*) into v_post_collides
    from public.posts
    where id between 'a1000000-0000-0000-0000-000000000000'
                 and 'a1000000-0000-0000-0000-0000000000ff';
  if v_post_collides > 0 then
    raise exception 'PRECONDITION: % fixture post uuid(s) already exist — refusing to proceed', v_post_collides;
  end if;

  -- mute/block target relationships must not pre-exist (we refuse to touch
  -- existing relationship data, so we simply require the slots to be free).
  -- Pair 1: the mute fixture pair (null <-> test3).
  if exists (
    select 1 from public.user_mutes
    where (muter_id = v_nullp and muted_id = v_test3)
       or (muter_id = v_test3 and muted_id = v_nullp)
  ) then
    raise exception 'PRECONDITION: a mute already exists between the two active profiles (test3 / NULL-username profile) — aborting rather than touching real data';
  end if;
  if exists (
    select 1 from public.user_blocks
    where (blocker_id = v_nullp and blocked_id = v_test3)
       or (blocker_id = v_test3 and blocked_id = v_nullp)
  ) then
    raise exception 'PRECONDITION: a block already exists between the two active profiles (test3 / NULL-username profile) — aborting rather than touching real data';
  end if;
  -- Pair 2: the block-test pair (shriniketh28 <-> test3). The block slot must
  -- be free in BOTH directions, and no pre-existing mute between them either
  -- (a mute would make the 7p positive control fail for reasons unrelated to
  -- blocking).
  if exists (
    select 1 from public.user_blocks
    where (blocker_id = v_deact and blocked_id = v_test3)
       or (blocker_id = v_test3 and blocked_id = v_deact)
  ) then
    raise exception 'PRECONDITION: a block already exists between shriniketh28 and test3 — aborting rather than touching real data';
  end if;
  if exists (
    select 1 from public.user_mutes
    where (muter_id = v_deact and muted_id = v_test3)
       or (muter_id = v_test3 and muted_id = v_deact)
  ) then
    raise exception 'PRECONDITION: a mute already exists between shriniketh28 and test3 — would invalidate the 7p positive control; aborting';
  end if;

  -- settings rows: record what exists; test3's row is temporarily flipped
  -- (see below), the NULL-username profile's row is never modified
  select exists (select 1 from public.user_settings where user_id = v_test3)
    into v_test3_has_settings;
  select exists (select 1 from public.user_settings where user_id = v_nullp)
    into v_null_has_settings;
  select coalesce(bool_or(is_private), false) into v_null_is_private
    from public.user_settings where user_id = v_nullp;

  -- "test3" is the PUBLIC author fixture. Its real settings row is currently
  -- is_private = true, so the test flips it to false TEMPORARILY, inside this
  -- transaction only:
  --   * the row must exist and be UNIQUE for test3 — 0 rows (nothing to flip)
  --     or more than 1 row (ambiguous target) aborts before any write
  --   * the original value is echoed via raise notice for the record
  --   * the flip is reverted by the final ROLLBACK. This holds on the success
  --     path AND when any assertion fails: a failure raises an exception,
  --     which aborts the entire transaction, so the original is_private=true
  --     (or NULL) value can never persist.
  --   * no other column, row, profile, or account is modified
  if v_test3_has_settings then
    select count(*) into v_test3_settings_count
      from public.user_settings where user_id = v_test3;
    if v_test3_settings_count <> 1 then
      raise exception 'PRECONDITION: expected exactly one user_settings row for test3, found %; refusing to create the temporary public-author fixture', v_test3_settings_count;
    end if;
    select is_private into v_test3_orig_private from public.user_settings where user_id = v_test3;
    update public.user_settings set is_private = false where user_id = v_test3;
    if not found then
      raise exception 'PRECONDITION: temporary is_private flip for test3 affected 0 rows; aborting';
    end if;
    raise notice 'fixture: TEMPORARILY set is_private=false on test3''s settings row (was %); restored by final ROLLBACK', coalesce(v_test3_orig_private::text, 'NULL');
  else
    insert into public.user_settings (user_id, is_private) values (v_test3, false);
    raise notice 'fixture: created (temporary) public settings row (is_private = false) for test3';
  end if;

  -- "null" (the NULL-username profile pinned to UUID
  -- 0297ce79-83d2-4659-a24b-071fffdae0c2) is the PRIVATE author fixture:
  --   * if a settings row exists it must already be private; we never flip it
  --   * if none exists, the test creates one (rollback removes it)
  if v_null_has_settings then
    if not v_null_is_private then
      raise exception 'PRECONDITION: the NULL-username profile has an existing non-private settings row; aborting rather than modifying real data';
    end if;
    raise notice 'fixture: using pre-existing PRIVATE settings row for the NULL-username profile (untouched)';
  else
    insert into public.user_settings (user_id, is_private) values (v_nullp, true);
    raise notice 'fixture: created (temporary) private settings row for the NULL-username profile';
  end if;
end $pre$;

-- ---------------------------------------------------------------------------
-- phase 1: data fixtures
-- ---------------------------------------------------------------------------
insert into public.group_chats (id, name, created_by)
values ('b1000000-0000-0000-0000-000000000001', '__rls_test_group__',
        (select id from public.profiles where lower(username) = 'test3'));

-- NOTE: this insert targets the LIVE database, where group_members carries an
-- `id uuid` primary key. On a database built purely from supabase/schema.sql
-- (PK = (group_id, user_id), no id column) remove the id/joined_at columns:
--   insert into public.group_members (group_id, user_id, role) values (...)
insert into public.group_members (id, group_id, user_id, role, joined_at)
values (gen_random_uuid(),
        'b1000000-0000-0000-0000-000000000001',
        (select id from public.profiles where lower(username) = 'shriniketh28'),
        'member', now());

insert into public.posts (id, user_id, content, post_type, media_urls, audience_scope, group_id) values
 ('a1000000-0000-0000-0000-000000000001', (select id from public.profiles where lower(username)='test3'),        '__rls_everyone__',    'text', '{}', 'Everyone',       null),
 ('a1000000-0000-0000-0000-000000000002', '0297ce79-83d2-4659-a24b-071fffdae0c2', '__rls_private__',     'text', '{}', 'Everyone',       null),
 ('a1000000-0000-0000-0000-000000000003', (select id from public.profiles where lower(username)='test3'),        '__rls_grp_every__',   'text', '{}', 'Everyone',       'b1000000-0000-0000-0000-000000000001'),
 ('a1000000-0000-0000-0000-000000000004', (select id from public.profiles where lower(username)='test3'),        '__rls_grp_comm__',    'text', '{}', 'Community Only', 'b1000000-0000-0000-0000-000000000001'),
 ('a1000000-0000-0000-0000-000000000005', (select id from public.profiles where lower(username)='test3'),        '__rls_null_scope__',  'text', '{}', null,             null),
 ('a1000000-0000-0000-0000-000000000006', (select id from public.profiles where lower(username)='test3'),        '__rls_weird_scope__', 'text', '{}', 'weird value',    null),
 ('a1000000-0000-0000-0000-000000000007', (select id from public.profiles where lower(username)='shriniketh28'), '__rls_deactivated__', 'text', '{}', 'Everyone',       null);

-- ---------------------------------------------------------------------------
-- assertion helper (temporary, transaction-scoped)
--   * select pg_temp.rls_case(...) — the pg_temp. qualification is required at
--     call time because search_path inside DO blocks is not guaranteed to
--     include pg_temp first.
--   * set_config(..., is_local => true) keeps role + JWT settings scoped to
--     this transaction. BOTH claim mechanisms are set consistently:
--     request.jwt.claims (the JSON document auth.uid() reads) and
--     request.jwt.claim.sub (the scalar claim some PostgREST/GoTrue versions
--     consult). The final set_config restores postgres and clears BOTH.
--   * Every case first verifies fixture identity as postgres (RLS-exempt,
--     table owner) BEFORE switching roles; the visibility assertion itself
--     always runs under the impersonated role with full RLS applied.
--   * a failed assertion raises AFTER recording, aborting the whole transaction.
-- ---------------------------------------------------------------------------
create or replace function pg_temp.rls_case(
  p_case text, p_expected boolean, p_post uuid, p_viewer uuid, p_detail text
) returns void language plpgsql as $fn$
declare v_seen boolean; v_fixture_ok boolean;
begin
  -- PRIVILEGED FIXTURE VERIFICATION (runs as postgres, before any role
  -- switching). Postgres owns the tables and therefore bypasses RLS, so this
  -- proves the fixture post (and, when supplied, viewer profile) actually
  -- exist without triggering RLS. Fixture identity here and visibility
  -- semantics below are kept separate on purpose.
  select
    exists (select 1 from public.posts where id = p_post)
    and (
      p_viewer is null
      or exists (select 1 from public.profiles where id = p_viewer)
    )
  into v_fixture_ok;
  if not v_fixture_ok then
    raise exception 'HARNESS BUG: fixture invalid for case % (post % or viewer % missing)', p_case, p_post, p_viewer;
  end if;

  if p_viewer is null then
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', '{}', true);
    perform set_config('request.jwt.claim.sub', '', true);
  else
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', p_viewer, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', p_viewer::text, true);
  end if;

  select exists (select 1 from public.posts where id = p_post) into v_seen;

  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  insert into test_results values (p_case, v_seen = p_expected,
    p_detail || ' -> seen=' || v_seen || ' expected=' || p_expected);

  if v_seen <> p_expected then
    raise exception 'CASE % FAILED: %', p_case, p_detail;
  end if;
  raise notice 'CASE % passed: %', p_case, p_detail;
end $fn$;

-- ---------------------------------------------------------------------------
-- phase 2: cases 1–5, 8–11
-- ---------------------------------------------------------------------------
-- case 1 — anon, Everyone + no group, public active author
select pg_temp.rls_case('1a', true,  'a1000000-0000-0000-0000-000000000001', null, 'anon sees Everyone/no-group post from public active author');

-- case 2 — anon, private-profile author
select pg_temp.rls_case('2',  false, 'a1000000-0000-0000-0000-000000000002', null, 'anon cannot see private-profile author post');

-- case 3 — anon, group posts
select pg_temp.rls_case('3a', false, 'a1000000-0000-0000-0000-000000000003', null, 'anon cannot see group post (Everyone+group)');
select pg_temp.rls_case('3b', false, 'a1000000-0000-0000-0000-000000000004', null, 'anon cannot see group post (Community Only)');

-- case 8 — NULL scope (anon + non-author + author-self)
select pg_temp.rls_case('8a', false, 'a1000000-0000-0000-0000-000000000005', null, 'anon cannot see NULL-scope post');
select pg_temp.rls_case('8b', false, 'a1000000-0000-0000-0000-000000000005', '0297ce79-83d2-4659-a24b-071fffdae0c2', 'non-author cannot see NULL-scope post');
select pg_temp.rls_case('8c', false, 'a1000000-0000-0000-0000-000000000005', (select id from public.profiles where lower(username)='test3'), 'AUTHOR cannot see own NULL-scope post (no self exception, per product decision)');

-- case 9 — unknown scope (anon + author-self)
select pg_temp.rls_case('9a', false, 'a1000000-0000-0000-0000-000000000006', null, 'anon cannot see unknown-scope post');
select pg_temp.rls_case('9b', false, 'a1000000-0000-0000-0000-000000000006', (select id from public.profiles where lower(username)='test3'), 'AUTHOR cannot see own unknown-scope post');

-- case 4 — authenticated non-member vs group posts
select pg_temp.rls_case('4a', false, 'a1000000-0000-0000-0000-000000000003', '0297ce79-83d2-4659-a24b-071fffdae0c2', 'non-member cannot see group post (Everyone+group)');
select pg_temp.rls_case('4b', false, 'a1000000-0000-0000-0000-000000000004', '0297ce79-83d2-4659-a24b-071fffdae0c2', 'non-member cannot see group post (Community Only)');

-- case 5 — authenticated member vs group posts
-- (member is the deactivated profile; viewer-side deactivation is not part of
--  the policy, so this is a valid membership check)
select pg_temp.rls_case('5a', true,  'a1000000-0000-0000-0000-000000000003', (select id from public.profiles where lower(username)='shriniketh28'), 'member sees group post (Everyone+group)');
select pg_temp.rls_case('5b', true,  'a1000000-0000-0000-0000-000000000004', (select id from public.profiles where lower(username)='shriniketh28'), 'member sees group post (Community Only)');

-- case 10 — deactivated author
select pg_temp.rls_case('10a', false, 'a1000000-0000-0000-0000-000000000007', null, 'anon cannot see deactivated author post');
select pg_temp.rls_case('10b', false, 'a1000000-0000-0000-0000-000000000007', '0297ce79-83d2-4659-a24b-071fffdae0c2', 'non-author cannot see deactivated author post');

-- case 11 — author self
select pg_temp.rls_case('11a', true, 'a1000000-0000-0000-0000-000000000001', (select id from public.profiles where lower(username)='test3'), 'author sees own Everyone post');
select pg_temp.rls_case('11b', true, 'a1000000-0000-0000-0000-000000000007', (select id from public.profiles where lower(username)='shriniketh28'), 'deactivated author sees own post (self short-circuit)');

-- ---------------------------------------------------------------------------
-- phase 3: case 6 — viewer mutes author
--   * the mute row is inserted only (precondition already guaranteed the slot
--     was free), and the transaction rolls it back. No delete, ever.
-- ---------------------------------------------------------------------------
do $mute$
declare
  v_viewer uuid; v_author uuid;
  v_seen_post boolean; v_profile_ok boolean; v_anon_seen boolean;
begin
  -- viewer is the NULL-username private-fixture profile, pinned by UUID:
  v_viewer := '0297ce79-83d2-4659-a24b-071fffdae0c2';
  v_author := (select id from public.profiles where lower(username) = 'test3');

  insert into public.user_mutes (muter_id, muted_id) values (v_viewer, v_author);

  -- 6a: viewer cannot see muted author's Everyone post
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_viewer, 'role','authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_viewer::text, true);
  select exists (select 1 from public.posts where id = 'a1000000-0000-0000-0000-000000000001') into v_seen_post;
  select exists (select 1 from public.profiles where id = v_author) into v_profile_ok;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  insert into test_results values ('6a', v_seen_post = false, 'mute hides post from viewer, seen=' || v_seen_post);
  if v_seen_post then raise exception 'CASE 6a FAILED: muted post still visible'; end if;
  raise notice 'CASE 6a passed: mute hides post';

  -- 6b: profile remains visitable (mute never blocks profile access)
  insert into test_results values ('6b', v_profile_ok = true, 'muted author profile still visitable, seen=' || v_profile_ok);
  if not v_profile_ok then raise exception 'CASE 6b FAILED: mute blocked profile visit'; end if;
  raise notice 'CASE 6b passed: profile visitable despite mute';

  -- 6c: anon is unaffected by someone else's mute
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  select exists (select 1 from public.posts where id = 'a1000000-0000-0000-0000-000000000001') into v_anon_seen;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  insert into test_results values ('6c', v_anon_seen = true, 'anon unaffected by another viewer''s mute, seen=' || v_anon_seen);
  if not v_anon_seen then raise exception 'CASE 6c FAILED: mute leaked to anon'; end if;
  raise notice 'CASE 6c passed: anon unaffected';
end $mute$;

-- ---------------------------------------------------------------------------
-- phase 4: case 7 — blocking, ONE DIRECTION ONLY, with positive control
--   * The fixture inserts exactly ONE block row: v_viewer (shriniketh28) ->
--     v_author (test3). It is test-created (the phase-0 precondition verified
--     neither direction pre-exists, and that no mute exists between the pair)
--     and vanishes at rollback. No delete.
--   * Assertion 7p is a POSITIVE CONTROL recorded BEFORE the block is
--     inserted: it proves the viewer can see the author's public Everyone
--     post while unblocked, so a passing 7a denial is attributable to the
--     block alone and not to some unrelated visibility condition.
--   * Cases 7a/7b test ONLY this single direction: a viewer who blocked the
--     author cannot see the author's post or visit the author's profile.
--   * The viewer is the deactivated profile shriniketh28; viewer-side
--     deactivation is not part of the policy (only author-side is checked),
--     so it remains a valid viewer — the same assumption cases 5a/5b rely on.
--   * REVERSE-DIRECTION BLOCKING (author blocks viewer) IS NOT TESTED by this
--     script. Its symmetry is supported by code review of can_view_profile —
--     both orderings appear in the same symmetric NOT EXISTS — but that
--     symmetry is NOT verified here. Isolating reverse-direction proof would
--     require a second public author and a block between it and test3; not
--     done to keep the fixture set minimal and avoid touching further real
--     profiles. Earlier 7c/7d assertions were removed for exactly this reason:
--     against the current fixture set they would have tested the private-
--     profile fixture, not the block.
-- ---------------------------------------------------------------------------
do $block$
declare
  v_viewer uuid; v_author uuid;
  v_seen_v boolean; v_prof_v boolean;
begin
  v_viewer := (select id from public.profiles where lower(username) = 'shriniketh28');
  v_author := (select id from public.profiles where lower(username) = 'test3');

  -- 7p: POSITIVE CONTROL (before the block exists) — the viewer can see the
  -- author's public Everyone post while unblocked. This makes the later 7a
  -- denial attributable to the block alone.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_viewer, 'role','authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_viewer::text, true);
  select exists (select 1 from public.posts where id = 'a1000000-0000-0000-0000-000000000001') into v_seen_v;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  insert into test_results values ('7p', v_seen_v = true, 'positive control: viewer sees the post BEFORE the block, seen=' || v_seen_v);
  if not v_seen_v then raise exception 'CASE 7p FAILED: positive control failed — viewer cannot see the post even before the block'; end if;
  raise notice 'CASE 7p passed: positive control (pre-block visibility)';

  -- one-directional fixture only; the phase-0 precondition already verified
  -- neither direction pre-exists, so this insert is unambiguously test-owned
  insert into public.user_blocks (blocker_id, blocked_id)
  values (v_viewer, v_author);

  -- 7a: viewer who blocked the author cannot see the author's Everyone post
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_viewer, 'role','authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_viewer::text, true);
  select exists (select 1 from public.posts where id = 'a1000000-0000-0000-0000-000000000001') into v_seen_v;
  select exists (select 1 from public.profiles where id = v_author) into v_prof_v;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  insert into test_results values ('7a', v_seen_v = false, 'viewer who blocked the author cannot see their post, seen=' || v_seen_v);
  if v_seen_v then raise exception 'CASE 7a FAILED: viewer who blocked the author still sees the post'; end if;
  raise notice 'CASE 7a passed';

  insert into test_results values ('7b', v_prof_v = false, 'viewer who blocked the author cannot visit their profile');
  if v_prof_v then raise exception 'CASE 7b FAILED: viewer who blocked the author still visits the profile'; end if;
  raise notice 'CASE 7b passed';

  -- 7c/7d REMOVED as executable assertions: the reverse direction (v_author ->
  -- v_viewer) was never inserted, so asserting denial here would be testing
  -- the PRIVATE-profile fixture, not the block. Reverse-direction block
  -- behaviour is NOT TESTED by this script — see the header comment above.
  -- (Reverse-direction symmetry is supported by code review of
  --  can_view_profile only; see also the phase-4 header.)
end $block$;

-- ---------------------------------------------------------------------------
-- summary (only reached if every assertion passed — any failure already
-- raised and aborted the transaction, so this summary is all-pass by design)
-- ---------------------------------------------------------------------------
select case_no, ok, detail from test_results order by case_no;

-- expected assertion count: 23 total = 17 pg_temp.rls_case helper calls
-- (cases 1–5, 8–11) + 3 mute assertions (6a/6b/6c) + 3 block assertions
-- (7p positive control + 7a/7b).
do $sum$
declare v_fail int; v_total int;
begin
  select count(*) into v_total from test_results;
  select count(*) into v_fail  from test_results where not ok;
  if v_total <> 23 then
    raise exception 'UNEXPECTED ASSERTION COUNT: expected 23, got %', v_total;
  end if;
  raise notice 'RLS VERIFICATION COMPLETE: % cases, % failures', v_total, v_fail;
end $sum$;

rollback;
