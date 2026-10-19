import { test } from "node:test";
import assert from "node:assert/strict";

Object.assign(process.env, { NODE_ENV: "test" });

import { setSession, getSessionUserId, getCurrentUser, getSessionToken, clearSession } from "@/lib/session";
import { resetDB } from "./stubs/db-stub.mjs";

interface TestGlobals {
  __motionCookieJar?: CookieJar;
  __motionHeaders?: Map<string, string>;
}

type UserLike = { id: string; handle: string; name: string; deactivatedAt: string | null };

type DBLike = { users: UserLike[]; sessions: Array<{ token: string; userId: string; device: string; createdAt: string; lastSeenAt: string }> };

class CookieJar {
  store = new Map<string, string>();
  lastSetOptions?: { name: string; value: string; options?: Record<string, unknown> };
  get(name: string): { name: string; value: string } | undefined {
    const value = this.store.get(name);
    return value === undefined ? undefined : { name, value };
  }
  set(name: string, value: string, options?: Record<string, unknown>): void {
    this.store.set(name, value);
    this.lastSetOptions = { name, value, options };
  }
  delete(name: string): void {
    this.store.delete(name);
  }
}

const maya: UserLike = { id: "u_maya", handle: "mayacodes", name: "Maya", deactivatedAt: null };
const zoe: UserLike = { id: "u_zoe", handle: "zoedesigns", name: "Zoe", deactivatedAt: new Date().toISOString() };

const anyDB = { users: [maya, zoe], sessions: [] } as unknown as Parameters<typeof resetDB>[0];

function dbWithSessions(records: Array<{ token: string; userId: string; device?: string; createdAt: string; lastSeenAt?: string }>): Parameters<typeof resetDB>[0] {
  return {
    users: [maya, zoe],
    sessions: records.map((r) => ({ token: r.token, userId: r.userId, device: r.device ?? "test", createdAt: r.createdAt, lastSeenAt: r.lastSeenAt ?? r.createdAt })),
  } as unknown as Parameters<typeof resetDB>[0];
}

const g = globalThis as typeof globalThis & TestGlobals;

function freshDB(): void {
  resetDB({ users: [maya, zoe], sessions: [] } as unknown as Parameters<typeof resetDB>[0]);
}

function installJar(): CookieJar {
  const jar = new CookieJar();
  g.__motionCookieJar = jar;
  g.__motionHeaders = new Map([["user-agent", "test-agent"]]);
  return jar;
}

function cookie(value: string): void {
  installJar().store.set("motion_session", value);
}

test("raw user-ID cookies are rejected", async (t) => {
  await t.test("raw id of an existing active user is rejected", async () => {
    freshDB();
    cookie("u_maya");
    assert.equal(await getSessionUserId(), null);
    assert.equal(await getCurrentUser(), null);
  });

  await t.test("arbitrary raw string is rejected", async () => {
    freshDB();
    cookie("anything-here");
    assert.equal(await getSessionUserId(), null);
  });
});

test("invalid session tokens are rejected", async (t) => {
  await t.test("s_ token not present in the store", async () => {
    freshDB();
    cookie("s_deadbeefdeadbeefdeadbeef");
    assert.equal(await getSessionUserId(), null);
  });

  await t.test("s_ prefix with garbage payload", async () => {
    freshDB();
    cookie("s_");
    assert.equal(await getSessionUserId(), null);
  });
});

test("valid server-issued sessions keep working", async (t) => {
  await t.test("setSession issues a token that resolves to the user", async () => {
    const jar = installJar();
    freshDB();
    await setSession("u_maya");

    const token = jar.get("motion_session")?.value ?? "";
    assert.match(token, /^s_/);
    assert.equal(await getSessionUserId(), "u_maya");
    assert.equal((await getCurrentUser())?.id, "u_maya");
    assert.equal(await getSessionToken(), token);
  });

  await t.test("direct session record resolves via getSessionUserId", async () => {
    freshDB();
    cookie("s_abc123");
    const now = new Date().toISOString();
    const record = { token: "s_abc123", userId: "u_maya", device: "test", createdAt: now, lastSeenAt: now };
    resetDB({ users: [maya, zoe], sessions: [record] } as unknown as Parameters<typeof resetDB>[0]);
    assert.equal(await getSessionUserId(), "u_maya");
  });
});

test("sessions for deactivated users are rejected", async () => {
  freshDB();
  const jar = installJar();
  await setSession("u_zoe");
  assert.ok((jar.get("motion_session")?.value ?? "").startsWith("s_"));
  assert.equal(await getSessionUserId(), null);
});

test("revoked sessions stop authenticating", async (t) => {
  await t.test("logout (clearSession) invalidates the token", async () => {
    freshDB();
    const jar = installJar();
    await setSession("u_maya");
    const token = jar.get("motion_session")?.value ?? "";
    assert.ok(token.startsWith("s_"));
    assert.equal(await getSessionUserId(), "u_maya");

    await clearSession();
    assert.equal(jar.get("motion_session"), undefined);
    assert.equal(await getSessionUserId(), null);
  });

  await t.test("removing the store record (remote revoke from another device) invalidates the token", async () => {
    freshDB();
    const jar = installJar();
    await setSession("u_maya");
    const token = jar.get("motion_session")?.value ?? "";
    assert.equal(await getSessionUserId(), "u_maya");

    resetDB({ ...anyDB, sessions: [] });
    assert.equal(await getSessionUserId(), null);
    assert.equal(jar.get("motion_session")?.value, token);
  });
});

test("expired sessions stop authenticating", async (t) => {
  const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  await t.test("session created 31 days ago is expired", async () => {
    installJar();
    cookie("s_expired");
    resetDB(dbWithSessions([{ token: "s_expired", userId: "u_maya", createdAt: daysAgo(31) }]));
    assert.equal(await getSessionUserId(), null);
  });

  await t.test("session created 25 days ago still works", async () => {
    installJar();
    cookie("s_recent");
    resetDB(dbWithSessions([{ token: "s_recent", userId: "u_maya", createdAt: daysAgo(25) }]));
    assert.equal(await getSessionUserId(), "u_maya");
  });

  await t.test("unparseable createdAt is treated as expired", async () => {
    installJar();
    cookie("s_badcreated");
    resetDB(dbWithSessions([{ token: "s_badcreated", userId: "u_maya", createdAt: "not-a-date" }]));
    assert.equal(await getSessionUserId(), null);
  });
});

test("session cookie secure flag tracks production", async (t) => {
  await t.test("production login sets a secure cookie", async () => {
    freshDB();
    const jar = installJar();
    Object.assign(process.env, { NODE_ENV: "production" });
    try {
      await setSession("u_maya");
      assert.equal(jar.lastSetOptions?.options?.secure, true);
    } finally {
      Object.assign(process.env, { NODE_ENV: "test" });
    }
  });

  await t.test("test/dev environment leaves secure off for plain-HTTP localhost", async () => {
    freshDB();
    const jar = installJar();
    await setSession("u_maya");
    const secure = jar.lastSetOptions?.options?.secure;
    assert.ok(secure === undefined || secure === false);
  });
});
