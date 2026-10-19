/**
 * Audit P0-3 regression: the admin authorization gate.
 *
 * 1. When Supabase is configured, admin decisions require a VERIFIED Supabase
 *    identity â€” a legacy session carrying an operator-admin email can never
 *    cross the gate (the previously exploitable fallback).
 * 2. When Supabase is not configured, operator-managed legacy admins remain
 *    supported, because no API can set or change a legacy email (P0-3 fix B).
 * 3. The full legacy exploit chain â€” unverified email at signup or via
 *    settings PATCH, then GET and a destructive admin PATCH â€” is denied, and
 *    denials are distinguished from unrelated errors by exact status + body.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

Object.assign(process.env, {
  NODE_ENV: "test",
  MOTION_ADMIN_EMAILS: "admin@test.local",
});

import { asNextRequest, baseSession, globals, localUser, makeJar } from "./helpers/route-test.ts";
import { getDB as _getDB, resetDB } from "./stubs/db-stub.mjs";

type FixtureDB = { users: Array<{ id: string; email?: string }>; reports: Array<Record<string, unknown>> };
const getDB = _getDB as unknown as () => FixtureDB;

const { GET: adminGET, PATCH: adminPATCH } = (await import("@/app/api/admin/reports/route")) as unknown as {
  GET: () => Promise<Response>;
  PATCH: (req: Request) => Promise<Response>;
};
const { POST: sessionPOST } = (await import("@/app/api/session/route")) as unknown as {
  POST: (req: Request) => Promise<Response>;
};
const { PATCH: settingsPATCH } = (await import("@/app/api/settings/route")) as unknown as {
  PATCH: (req: Request) => Promise<Response>;
};

const ADMIN_EMAIL = "admin@test.local";

const SUPABASE_URL_KEY = "NEXT_PUBLIC_SUPABASE_URL";
const SUPABASE_ANON_KEY = "NEXT_PUBLIC_SUPABASE_ANON_KEY";

function configureSupabase(configured: boolean): () => void {
  const saved = {
    [SUPABASE_URL_KEY]: process.env[SUPABASE_URL_KEY],
    [SUPABASE_ANON_KEY]: process.env[SUPABASE_ANON_KEY],
  } as Record<string, string | undefined>;
  if (configured) Object.assign(process.env, { [SUPABASE_URL_KEY]: "https://test.supabase.co", [SUPABASE_ANON_KEY]: "test-anon-key" });
  else { delete process.env[SUPABASE_URL_KEY]; delete process.env[SUPABASE_ANON_KEY]; }
  return () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else Object.assign(process.env, { [k]: v });
    }
    (globalThis as { __motionSupabase?: unknown }).__motionSupabase = undefined;
  };
}

function setSupabaseUser(user: { id: string; email?: string | null } | null): void {
  (globalThis as { __motionSupabase?: unknown }).__motionSupabase = user ? { user } : null;
}

function installJar(stored: Array<[string, string]> = []): ReturnType<typeof makeJar> {
  const jar = makeJar(stored);
  globals().__motionCookieJar = jar;
  globals().__motionHeaders = new Map([["user-agent", "test-agent"]]);
  return jar;
}

function jsonRequest(url: string, body: unknown): Request {
  return asNextRequest(
    new Request(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  );
}

function postRequest(url: string, body: unknown): Request {
  return asNextRequest(
    new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  );
}

/** Local store fixture: an operator-managed admin, a victim, and one open report. */
interface AdminFixture {
  users: Array<Record<string, unknown>>;
  posts: never[];
  chats: never[];
  connections: never[];
  reports: Array<Record<string, unknown>>;
  sessions: Array<Record<string, unknown>>;
  loginEvents: never[];
}

function adminFixture(sessionToken?: string): AdminFixture {
  return {
    users: [
      localUser("u_admin", "operatedmin", { email: ADMIN_EMAIL, deactivatedAt: null }),
      localUser("u_victim", "victimuser", { deactivatedAt: null }),
      localUser("u_maya", "mayacodes", { deactivatedAt: null }),
    ],
    posts: [],
    chats: [],
    connections: [],
    reports: [{ id: "r1", reporterId: "u_maya", targetType: "user", targetId: "u_victim", reason: "abuse", createdAt: new Date().toISOString() }],
    sessions: sessionToken ? [baseSession(sessionToken, "u_admin")] : [],
    loginEvents: [],
  } as unknown as unknown as Parameters<typeof resetDB>[0];
}

test("Exploit chain 1 â€” legacy signup cannot claim an admin email", async () => {
  installJar();
  resetDB(adminFixture());
  const restore = configureSupabase(false);
  try {
    const res = await sessionPOST(
      postRequest("http://localhost:3000/api/session", {
        mode: "signup",
        handle: "evillurker",
        name: "Evil Lurker",
        password: "password123",
        email: ADMIN_EMAIL,
      })
    );
    assert.equal(res.status, 201, "signup itself still succeeds");
    const created = await res.json();
    assert.ok(created.user, "signup returns the account");

    const gate = await adminGET();
    assert.equal(gate.status, 403, "self-claimed admin email must not authorize");
    const body = (await gate.json()) as { error?: string };
    assert.equal(body.error, "Admin access required.", "exact denial body (not an unrelated error like 401/404/500)");
  } finally {
    restore();
  }
});

test("Exploit chain 2 â€” settings PATCH cannot change a legacy email into a credential", async () => {
  installJar();
  resetDB(adminFixture());
  const restore = configureSupabase(false);
  try {
    // Sign in first (demo mode is intentionally available outside production).
    const login = await sessionPOST(
      postRequest("http://localhost:3000/api/session", { mode: "demo", handle: "mayacodes", password: "demo" })
    );
    assert.equal(login.status, 200);
    assert.equal((await login.json() as { user?: { id?: string } }).user?.id, "u_maya");

    const res = await settingsPATCH(
      jsonRequest("http://localhost:3000/api/settings", { email: ADMIN_EMAIL, name: "Maya Chen" })
    );
    assert.equal(res.status, 200, "PATCH compatibility preserved (other fields still apply)");
    assert.equal((getDB() as { users: Array<{ id: string; email?: string }> }).users.find((u) => u.id === "u_maya")?.email, undefined, "email was not stored");

    const gate = await adminGET();
    assert.equal(gate.status, 403);
    const body = (await gate.json()) as { error?: string };
    assert.equal(body.error, "Admin access required.");
  } finally {
    restore();
  }
});

test("Operator-managed legacy admin still works when Supabase is NOT configured (GET + destructive PATCH)", async () => {
  installJar([["motion_session", "s_operator"]]);
  resetDB(adminFixture("s_operator"));
  const restore = configureSupabase(false);
  try {
    const gate = await adminGET();
    assert.equal(gate.status, 200, "operator-installed admin email authorizes in a local-only deployment");
    const queue = (await gate.json()) as { reports: Array<{ target?: { handle?: string } }> };
    assert.equal(queue.reports.length, 1);
    assert.equal(queue.reports[0]?.target?.handle, "victimuser");

    const before = getDB() as unknown as Parameters<typeof resetDB>[0];
    assert.ok(before.users.some((u: { id: string }) => u.id === "u_victim"), "victim exists before the destructive action");

    const action = await adminPATCH(
      jsonRequest("http://localhost:3000/api/admin/reports", { reportId: "r1", action: "delete_user" })
    );
    assert.equal(action.status, 200, "destructive PATCH executes for the authorized operator admin");
    const after = getDB() as unknown as Parameters<typeof resetDB>[0];
    assert.ok(!after.users.some((u: { id: string }) => u.id === "u_victim"), "delete_user really ran in local mode");
  } finally {
    restore();
  }
});

test("Supabase-configured deployment: legacy session with the admin email can NEVER reach the gate", async (t) => {
  await t.test("GET â€” legacy admin session, no Supabase identity â†’ 401, and the store is untouched", async () => {
    installJar([["motion_session", "s_operator"]]);
    resetDB(adminFixture("s_operator"));
    const restore = configureSupabase(true);
    try {
      setSupabaseUser(null);
      const gate = await adminGET();
      assert.equal(gate.status, 401, "denied: no verified Supabase identity (previously the exploitable path)");
      const body = (await gate.json()) as { error?: string };
      assert.equal(body.error, "Sign in required.");
      const after = getDB() as unknown as Parameters<typeof resetDB>[0];
      assert.ok(after.users.some((u: { id: string }) => u.id === "u_victim"), "GET did not mutate the store");
    } finally {
      restore();
    }
  });

  await t.test("PATCH â€” destructive delete_user denied and the report + victim survive", async () => {
    installJar([["motion_session", "s_operator"]]);
    resetDB(adminFixture("s_operator"));
    const restore = configureSupabase(true);
    try {
      setSupabaseUser(null);
      const action = await adminPATCH(
        jsonRequest("http://localhost:3000/api/admin/reports", { reportId: "r1", action: "delete_user" })
      );
      assert.equal(action.status, 401, "denied before any destructive action");
      const after = getDB() as unknown as Parameters<typeof resetDB>[0];
      assert.ok(after.users.some((u: { id: string }) => u.id === "u_victim"), "victim not deleted");
      assert.equal(after.reports.length, 1, "report untouched");
    } finally {
      restore();
    }
  });

  await t.test("verified Supabase admin crosses the gate (503 = authorized, backend unconfigured â€” not 401/403)", async () => {
    installJar();
    resetDB(adminFixture());
    const restore = configureSupabase(true);
    try {
      setSupabaseUser({ id: "sb_admin", email: ADMIN_EMAIL });
      const gate = await adminGET();
      assert.equal(gate.status, 503, "authorization succeeded; only the service-role client is unconfigured");
      const body = (await gate.json()) as { error?: string };
      assert.match(body.error ?? "", /Admin service access is not configured/);
    } finally {
      restore();
    }
  });

  await t.test("verified non-admin Supabase user is denied before any fallback", async () => {
    installJar();
    resetDB(adminFixture());
    const restore = configureSupabase(true);
    try {
      setSupabaseUser({ id: "sb_user", email: "plain@test.local" });
      const gate = await adminGET();
      assert.equal(gate.status, 403);
      const body = (await gate.json()) as { error?: string };
      assert.equal(body.error, "Admin access required.");
    } finally {
      restore();
    }
  });
});
