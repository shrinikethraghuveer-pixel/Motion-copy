/**
 * Audit P0-1 regression: production must never expose or honor the local
 * demo/dev conveniences — demo login (password "demo" for any seeded account),
 * the demo-handle listing, or the no-cookie development identity fallback.
 * Runs against the route handlers + requireUser with the shared db-stub.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

Object.assign(process.env, { NODE_ENV: "test" });

import { asNextRequest, baseSession, globals, localUser, makeJar } from "./helpers/route-test.ts";
import { resetDB, setReadDBError } from "./stubs/db-stub.mjs";

const { GET: sessionGET, POST: sessionPOST } = (await import("@/app/api/session/route")) as unknown as {
  GET: () => Promise<Response>;
  POST: (req: Request) => Promise<Response>;
};
const { requireUser } = (await import("@/lib/server")) as unknown as {
  requireUser: () => Promise<{ res: Response } | { me: unknown; db: unknown }>;
};
const { getSessionUserId } = (await import("@/lib/session")) as unknown as {
  getSessionUserId: () => Promise<string | null>;
};

// The REAL db module (relative import bypasses the @/lib/db → stub mapping,
// loader re-resolves its "@/lib/seed" to the real source). Only used to
// instantiate the typed error for failure-injection — no I/O at module load.
const realDb = (await import("../src/lib/db.ts")) as unknown as {
  DataStoreUnavailableError: new (message: string) => Error;
};

const fixtureDB = () =>
  ({
    users: [localUser("u_maya", "mayacodes", { deactivatedAt: null })],
    connections: [],
    sessions: [],
    loginEvents: [],
  }) as unknown as Parameters<typeof resetDB>[0];

function installJar(stored: Array<[string, string]> = []): ReturnType<typeof makeJar> {
  const jar = makeJar(stored);
  globals().__motionCookieJar = jar;
  globals().__motionHeaders = new Map([["user-agent", "test-agent"]]);
  return jar;
}

function setNodeEnv(value: string): () => void {
  const prev = process.env.NODE_ENV;
  Object.assign(process.env, { NODE_ENV: value });
  return () => {
    Object.assign(process.env, { NODE_ENV: prev });
  };
}

function jar(): ReturnType<typeof makeJar> | undefined {
  return globals().__motionCookieJar as ReturnType<typeof makeJar> | undefined;
}

function sessionRequest(body: unknown): Request {
  return asNextRequest(
    new Request("http://localhost:3000/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

test("demo login is hard-disabled in production", async () => {
  installJar();
  resetDB(fixtureDB());
  const restore = setNodeEnv("production");
  try {
    const res = await sessionPOST(sessionRequest({ mode: "demo", handle: "mayacodes", password: "demo" }));
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error?: string };
    assert.equal(body.error, "Demo login is disabled in production.");
    assert.equal(jar()?.store.get("motion_session"), undefined, "no session is issued");
  } finally {
    restore();
  }
});

test("demo login still works in development (behavior preserved)", async () => {
  installJar();
  resetDB(fixtureDB());
  const restore = setNodeEnv("development");
  try {
    const res = await sessionPOST(sessionRequest({ mode: "demo", handle: "mayacodes", password: "demo" }));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { user?: { handle?: string } };
    assert.equal(body.user?.handle, "mayacodes");
    const token = jar()?.store.get("motion_session") ?? "";
    assert.match(token, /^s_/);
  } finally {
    restore();
  }
});

test("GET /api/session omits demo handles in production, real sessions still resolve", async () => {
  // Valid session for a real user (production users must keep working).
  installJar([["motion_session", "s_prodok"]]);
  resetDB({
    ...fixtureDB(),
    sessions: [baseSession("s_prodok", "u_maya")],
  } as unknown as Parameters<typeof resetDB>[0]);
  const restore = setNodeEnv("production");
  try {
    const res = await sessionGET();
    assert.equal(res.status, 200);
    const body = (await res.json()) as { user?: { handle?: string } | null; demoHandles: unknown[]; devFallback: boolean };
    assert.deepEqual(body.demoHandles, [], "no demo handles leak in production");
    assert.equal(body.devFallback, false);
    assert.equal(body.user?.handle, "mayacodes", "a genuinely signed-in production user still resolves");
  } finally {
    restore();
  }
});

test("GET /api/session keeps demo handles in development", async () => {
  installJar();
  resetDB(fixtureDB());
  const restore = setNodeEnv("development");
  try {
    const res = await sessionGET();
    assert.equal(res.status, 200);
    const body = (await res.json()) as { demoHandles: Array<{ handle: string }>; devFallback: boolean };
    assert.equal(body.demoHandles.length > 0, true);
    assert.equal(body.devFallback, true, "dev convenience flag stays visible in development");
  } finally {
    restore();
  }
});

test("production with no cookie is denied end-to-end (no dev fallback identity)", async () => {
  installJar();
  resetDB(fixtureDB());
  const restore = setNodeEnv("production");
  try {
    assert.equal(await getSessionUserId(), null);
    const viaRequireUser = await requireUser();
    assert.ok("res" in viaRequireUser, "requireUser must fail");
    assert.equal(viaRequireUser.res.status, 401);
  } finally {
    restore();
  }
});

test("development no-cookie fallback still resolves the seeded user", async () => {
  installJar();
  resetDB(fixtureDB());
  const restore = setNodeEnv("development");
  try {
    assert.equal(await getSessionUserId(), "u_maya");
  } finally {
    restore();
  }
});

test("a missing/corrupt local data store fails closed with a clear 503", async (t) => {
  await t.test("requireUser returns 503 with the operational message", async () => {
    installJar([["motion_session", "s_503"]]);
    resetDB({
      ...fixtureDB(),
      sessions: [baseSession("s_503", "u_maya")],
    } as unknown as Parameters<typeof resetDB>[0]);
    setReadDBError(new realDb.DataStoreUnavailableError("store missing"));
    const restore = setNodeEnv("production");
    try {
      const viaRequireUser = await requireUser();
      assert.ok("res" in viaRequireUser);
      assert.equal(viaRequireUser.res.status, 503);
      const body = (await viaRequireUser.res.json()) as { error?: string };
      assert.match(body.error ?? "", /data store unavailable/i);
    } finally {
      restore();
      setReadDBError(null);
    }
  });

  await t.test("GET /api/session returns 503 with the operational message", async () => {
    installJar();
    resetDB(fixtureDB());
    setReadDBError(new realDb.DataStoreUnavailableError("store missing"));
    const restore = setNodeEnv("production");
    try {
      const res = await sessionGET();
      assert.equal(res.status, 503);
      const body = (await res.json()) as { error?: string };
      assert.match(body.error ?? "", /data store unavailable/i);
    } finally {
      restore();
      setReadDBError(null);
    }
  });
});
