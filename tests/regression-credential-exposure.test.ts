/**
 * P0-2 remediation regression (pre-execution safety net):
 *
 * The exposed-value registry is SYNTHETIC in these tests (arbitrary
 * non-hex `s_`-prefixed strings + a fake scrypt shape) â€” real tokens and
 * hashes from the incident are NEVER written into test code, fixtures, or
 * output. The assertions prove the remediation lib invalidates exactly the
 * compromised records and nothing else, and that after invalidation the
 * exposed tokens no longer authenticate while unrelated sessions keep
 * working.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

Object.assign(process.env, { NODE_ENV: "test" });

import { asNextRequest, globals, localUser, makeJar } from "./helpers/route-test.ts";
import { resetDB } from "./stubs/db-stub.mjs";
import { requireUser } from "@/lib/server";
import {
  collectRemediationPlan,
  invalidateExposedSessions,
  clearAccountPasswordHashes,
  verifyRemediation,
} from "@/lib/credential-remediation";

// Synthetic stand-ins for the exposed historical values. The scrypt-shaped
// fake uses hex lengths (32:64) but a sentinel prefix digit so it can never
// collide with a real hash AND so the repo credential-shape scan's
// full-shape regex does not match committed code.
const EXPOSED_TOKEN_A = "s_synthetic_exposed_token_a";
const EXPOSED_TOKEN_B = "s_synthetic_exposed_token_b";
const UNRELATED_TOKEN = "s_synthetic_unrelated_token";
const EXPOSED_HASH_A = "p-sentinel-32-char-prefix-----------:-------------------------------------------------"; // non-real shape
const EXPOSED_HASH_B = "p-sentinel-32-char-prefix2----------:-------------------------------------------------"; // non-real shape

const UNRELATED_HASH = "p-sentinel-32-char-other-----------:-------------------------------------------------"; // non-real shape

function storeFixture(): Parameters<typeof resetDB>[0] {
  const now = new Date().toISOString();
  return {
    users: [
      localUser("u_target1", "targetacct1", { passwordHash: EXPOSED_HASH_A }),
      localUser("u_target2", "targetacct2", { passwordHash: EXPOSED_HASH_B }),
      localUser("u_keeper", "keeperacct", { passwordHash: UNRELATED_HASH }),
      localUser("u_sessionless", "nosessionsneeded", {}),
    ].map((u) => u as unknown as Record<string, unknown>),
    posts: [],
    chats: [],
    connections: [],
    reports: [],
    groups: [],
    sessions: [
      { token: EXPOSED_TOKEN_A, userId: "u_target1", device: "test", createdAt: now, lastSeenAt: now },
      { token: EXPOSED_TOKEN_B, userId: "u_target2", device: "test", createdAt: now, lastSeenAt: now },
      { token: UNRELATED_TOKEN, userId: "u_keeper", device: "test", createdAt: now, lastSeenAt: now },
    ],
    loginEvents: [],
  } as unknown as Parameters<typeof resetDB>[0];
}

type DbFixture = {
  users: Array<{ id: string; passwordHash?: string | null; [key: string]: unknown }>;
  sessions: Array<{ token: string; userId: string; device: string; createdAt: string; lastSeenAt: string }>;
  [key: string]: unknown;
};

function deepClone(): DbFixture {
  return JSON.parse(JSON.stringify(storeFixture())) as DbFixture;
}

const exposedTokens = new Set([EXPOSED_TOKEN_A, EXPOSED_TOKEN_B]);
const exposedHashes = new Set([EXPOSED_HASH_A, EXPOSED_HASH_B]);

test("plan identifies exactly the compromised records; expired values are reported, not matched", () => {
  const db = deepClone();
  const plan = collectRemediationPlan(db, exposedTokens, exposedHashes);
  assert.deepEqual(plan.sessions.map((s) => s.token), [EXPOSED_TOKEN_A, EXPOSED_TOKEN_B]);
  assert.deepEqual(plan.accounts.map((a) => a.userId).sort(), ["u_target1", "u_target2"]);
  assert.equal(plan.expiredTokens.length, 0);
  assert.equal(plan.retiredHashes.length, 0);
});

test("plan aborts when an exposed value is ambiguous (two live sessions share a token)", () => {
  const db = deepClone();
  db.sessions.push({ ...db.sessions[0] });
  assert.throws(() => collectRemediationPlan(db, exposedTokens, exposedHashes), /ambiguous/);
});

test("invalidation removes ONLY the compromised session records", () => {
  const db = deepClone();
  const plan = collectRemediationPlan(db, exposedTokens, exposedHashes);
  const removed = invalidateExposedSessions(db, plan.sessions.map((s) => s.token));
  assert.equal(removed, 2);
  assert.deepEqual(db.sessions.map((s) => s.token), [UNRELATED_TOKEN]);
});

test("hash clearing blanks ONLY the flagged accounts", () => {
  const db = deepClone();
  const plan = collectRemediationPlan(db, exposedTokens, exposedHashes);
  const cleared = clearAccountPasswordHashes(db, plan.accounts.map((a) => a.userId));
  assert.equal(cleared, 2);
  const byId = new Map(db.users.map((u) => [u.id, u.passwordHash]));
  assert.equal(byId.get("u_target1"), null);
  assert.equal(byId.get("u_target2"), null);
  assert.equal(byId.get("u_keeper"), UNRELATED_HASH, "unrelated account hash untouched");
});

test("post-change verification catches residuals and accepts a clean state", () => {
  const dirty = deepClone();
  dirty.sessions.push({ ...storeFixture().sessions[0] });
  const dirtyResult = verifyRemediation(dirty, exposedTokens, new Set());
  assert.equal(dirtyResult.ok, false);

  const clean = deepClone();
  invalidateExposedSessions(clean, [EXPOSED_TOKEN_A, EXPOSED_TOKEN_B]);
  clearAccountPasswordHashes(clean, ["u_target1", "u_target2"]);
  const cleanResult = verifyRemediation(clean, exposedTokens, new Set(["u_target1", "u_target2"]));
  assert.equal(cleanResult.ok, true);
});

test("end-to-end: after invalidation the exposed token 401s and the unrelated token still authenticates", async () => {
  // 1) Before remediation the exposed token authenticates.
  globals().__motionCookieJar = makeJar([["motion_session", EXPOSED_TOKEN_A]]);
  globals().__motionHeaders = new Map([["user-agent", "test-agent"]]);
  (globals() as { __motionSupabase?: unknown }).__motionSupabase = null;
  resetDB(storeFixture());
  const before = await requireUser();
  assert.ok(!("res" in before), "pre-remediation the exposed token must authenticate ( proving the test is meaningful)");

  // 2) Apply the remediation exactly as the script would.
  const db = deepClone();
  const plan = collectRemediationPlan(db, exposedTokens, exposedHashes);
  invalidateExposedSessions(db, plan.sessions.map((s) => s.token));
  resetDB(db);

  // 3) Exposed tokens no longer resolve.
  globals().__motionCookieJar = makeJar([["motion_session", EXPOSED_TOKEN_A]]);
  const deniedA = await requireUser();
  assert.ok("res" in deniedA && deniedA.res.status === 401, "exposed token A must be dead after remediation");

  globals().__motionCookieJar = makeJar([["motion_session", EXPOSED_TOKEN_B]]);
  const deniedB = await requireUser();
  assert.ok("res" in deniedB && deniedB.res.status === 401, "exposed token B must be dead after remediation");

  // 4) Requests WITHOUT a cookie also deny (nothing leaked into ambient state).
  globals().__motionCookieJar = makeJar([]);
  const deniedEmpty = await requireUser();
  assert.ok("res" in deniedEmpty && deniedEmpty.res.status === 401);

  // 5) Unrelated session still authenticates.
  globals().__motionCookieJar = makeJar([["motion_session", UNRELATED_TOKEN]]);
  const keeper = await requireUser();
  assert.ok(!("res" in keeper), "unrelated session must keep authenticating");
  assert.equal(keeper.me.id, "u_keeper");
});
