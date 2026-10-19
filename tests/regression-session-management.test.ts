/**
 * Audit 3B regression: Motion session management.
 *
 * 1. GET /api/settings returns OPAQUE session identifiers (server-computed
 *    SHA-256 prefixes) â€” raw session tokens never appear in the payload.
 * 2. revoke-session matches by opaque id, refuses to revoke the caller's
 *    live session, and 404s for someone else's session.
 * 3. Changing the password invalidates every OTHER Motion session of the
 *    account (the current session survives).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "crypto";

Object.assign(process.env, { NODE_ENV: "test" });

import { asNextRequest, baseSession, globals, localUser, makeJar } from "./helpers/route-test.ts";
import { getDB as _getDB, resetDB } from "./stubs/db-stub.mjs";

const getDB = _getDB as unknown as () => { sessions: Array<{ token: string; userId: string }> };

const { GET: settingsGET, POST: settingsPOST, PATCH: settingsPATCH } = (await import("@/app/api/settings/route")) as unknown as {
  GET: (req: Request) => Promise<Response>;
  POST: (req: Request) => Promise<Response>;
  PATCH: (req: Request) => Promise<Response>;
};
const { getSessionToken } = (await import("@/lib/session")) as unknown as {
  getSessionToken: () => Promise<string | null>;
};
const { hashPassword } = (await import("@/lib/auth")) as unknown as {
  hashPassword: (password: string) => string;
};

// keepSupabaseAuth ensures the legacy-store branch runs (no Supabase identity).
function installJar(stored: Array<[string, string]> = []): ReturnType<typeof makeJar> {
  const jar = makeJar(stored);
  globals().__motionCookieJar = jar;
  globals().__motionHeaders = new Map([["user-agent", "test-agent"]]);
  (globalThis as { __motionSupabase?: unknown }).__motionSupabase = null;
  return jar;
}

function fixture(current: string, extras: string[]): Parameters<typeof resetDB>[0] {
  return {
    users: [localUser("u_me", "sessuser", { passwordHash: hashPassword("test-password"), deactivatedAt: null })],
    posts: [],
    chats: [],
    connections: [],
    reports: [],
    sessions: [baseSession(current, "u_me"), ...extras.map((t) => baseSession(t, "u_me"))],
    loginEvents: [],
  } as unknown as Parameters<typeof resetDB>[0];
}

function settingsGetRequest(): Request {
  return asNextRequest(new Request("http://localhost:3000/api/settings", { headers: { cookie: "" } }));
}

function postActionRequest(body: unknown): Request {
  return asNextRequest(
    new Request("http://localhost:3000/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

function patchRequest(body: unknown): Request {
  return asNextRequest(
    new Request("http://localhost:3000/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

const opaque = (token: string): string => createHash("sha256").update(token).digest("hex").slice(0, 16);

test("GET /api/settings never echoes raw session tokens", async () => {
  installJar([["motion_session", "s_tok_current"]]);
  resetDB(fixture("s_tok_current", ["s_tok_other", "s_tok_third"]));
  const res = await settingsGET(settingsGetRequest());
  assert.equal(res.status, 200);
  const body = (await res.json()) as { sessions: Array<{ id: string; device: string }>; activeSessionId: string | null };
  const raw = JSON.stringify(body);
  assert.equal(raw.includes("s_tok_"), false, "raw tokens must not cross the wire");
  assert.equal(body.sessions.length, 3);
  for (const session of body.sessions) {
    assert.match(session.id, /^[0-9a-f]{16}$/, "session ids are opaque 16-hex prefixes");
  }
  assert.equal(body.sessions.find((s) => s.id === opaque("s_tok_current"))?.device, "test");
  assert.equal(body.sessions.find((s) => s.id === opaque("s_tok_other"))?.device, "test");
  assert.equal(body.activeSessionId, opaque("s_tok_current"), "the caller's own session is marked by opaque id");
});

test("revoke-session removes only the targeted OTHER session; revoking the live session is refused", async () => {
  installJar([["motion_session", "s_tok_current"]]);
  resetDB(fixture("s_tok_current", ["s_tok_other"]));
  const badRes = await settingsPOST(postActionRequest({ action: "revoke-session", id: opaque("s_tok_current") }));
  assert.equal(badRes.status, 400);
  assert.equal(((await badRes.json()) as { error: string }).error, "You can't revoke the session you're using right now.");

  const okRes = await settingsPOST(postActionRequest({ action: "revoke-session", id: opaque("s_tok_other") }));
  assert.equal(okRes.status, 200);
  assert.deepEqual(getDB().sessions.map((s) => s.token), ["s_tok_current"], "only the current session survives");

  const missingRes = await settingsPOST(postActionRequest({ action: "revoke-session", id: opaque("s_tok_other") }));
  assert.equal(missingRes.status, 404);
});

test("revoke-others keeps exactly the live session", async () => {
  installJar([["motion_session", "s_tok_current"]]);
  resetDB(fixture("s_tok_current", ["s_tok_a", "s_tok_b"]));
  const res = await settingsPOST(postActionRequest({ action: "revoke-others" }));
  assert.equal(res.status, 200);
  assert.deepEqual(getDB().sessions.map((s) => s.token), ["s_tok_current"]);
});

test("password change invalidates every OTHER session once the current password verifies", async () => {
  installJar([["motion_session", "s_tok_current"]]);
  resetDB(fixture("s_tok_current", ["s_tok_other", "s_tok_third"]));

  // Wrong current password â†’ nothing changes.
  const denied = await settingsPATCH(patchRequest({ newPassword: "brand-new-password", currentPassword: "not-it" }));
  assert.equal(denied.status, 403);
  assert.equal(getDB().sessions.length, 3, "denied password change keeps all sessions");

  const ok = await settingsPATCH(patchRequest({ newPassword: "brand-new-password", currentPassword: "test-password" }));
  assert.equal(ok.status, 200);
  assert.deepEqual(
    getDB().sessions.map((s) => s.token),
    ["s_tok_current"],
    "the current session survives; other sessions are dropped"
  );

  // Password verification uses scrypt(salt: stored) â€” failed verify above proves
  // the guard ran; a matching verify depends on the fixture hash. The first
  // PATCH (with the fixture password) must have succeeded for the session sweep
  // to have happened.
  assert.equal(await getSessionToken(), "s_tok_current");
});
