import { test, after } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Audit P3 group governance + P4/N2 throttle enforcement, exercised against
// the real route handlers on the legacy JSON store. Supabase-platform parity
// (RPC create_group_chat_with_members) is a deployment-verification item.
// ---------------------------------------------------------------------------

Object.assign(process.env, {
  NODE_ENV: "test",
  MOTION_ADMIN_EMAILS: "admin@test.local",
  // Explicitly declare the trusted header in tests so per-IP keys behave like
  // a correctly configured platform would. Client headers remain untrusted
  // for identity unless this platform signal exists.
  MOTION_TRUSTED_RL_HEADER: "x-real-ip",
});
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

import { resetDB } from "./stubs/db-stub.mjs";
import { asNextRequest, baseSession, globals, localUser, makeJar } from "./helpers/route-test.ts";

const { POST: groupChatsPOST } = (await import("@/app/api/group-chats/route")) as unknown as {
  POST: (request: Request) => Promise<Response>;
};
const { POST: connectionsPOST } = (await import("@/app/api/connections/route")) as unknown as {
  POST: (request: Request) => Promise<Response>;
};
const { POST: groupsPOST } = (await import("@/app/api/groups/route")) as unknown as {
  POST: (request: Request) => Promise<Response>;
};
const { PATCH: notificationsPATCH } = (await import("@/app/api/notifications/route")) as unknown as {
  PATCH: (request: Request) => Promise<Response>;
};
const { POST: sessionPOST } = (await import("@/app/api/session/route")) as unknown as {
  POST: (request: Request) => Promise<Response>;
};
const { PATCH: settingsPATCH } = (await import("@/app/api/settings/route")) as unknown as {
  PATCH: (request: Request) => Promise<Response>;
};
const { PATCH: adminReportsPATCH } = (await import("@/app/api/admin/reports/route")) as unknown as {
  PATCH: (request: Request) => Promise<Response>;
};

const g = globals();

const VIEW_TOKEN = "s_p3viewtoken01";
const ADMIN_TOKEN = "s_p3admintoken1";
const RATE_TOKEN = "s_p3ratetoken1";
const now = new Date().toISOString();

function member(userId: string, role: "admin" | "member" = "member"): Record<string, unknown> {
  return { userId, role, joinedAt: now };
}

function seed(): void {
  resetDB({
    users: [
      localUser("u_view", "viewer", { settings: { blocked: ["u_blocked2"] } }),
      { ...localUser("u_admin", "admin", { email: "admin@test.local" }) },
      { ...localUser("u_blocked", "blockedme", { settings: { blocked: ["u_view"] } }) },
      localUser("u_blocked2", "iblocked"),
      { ...localUser("u_deactivated", "gone", { deactivatedAt: now }) },
      localUser("u_ok", "okayuser"),
      { ...localUser("u_gatekeeper", "gatekeeper", { settings: { blocked: ["u_newcomer"] } }) },
      localUser("u_newcomer", "newcomer"),
      localUser("u_ratelimit", "ratelimits"),
    ],
    connections: [],
    chats: [],
    dmGroups: [
      {
        id: "g_open",
        name: "Open",
        description: "",
        avatarUrl: null,
        createdBy: "u_admin",
        members: [member("u_admin", "admin"), member("u_view"), member("u_gatekeeper")],
        messages: [],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "g_full",
        name: "Full house",
        description: "",
        avatarUrl: null,
        createdBy: "u_admin",
        members: [member("u_admin", "admin"), ...Array.from({ length: 19 }, (_, i) => member(`u_fill_${i}`))],
        messages: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
    posts: [],
    groups: [],
    notifications: [],
    sessions: [
      baseSession(VIEW_TOKEN, "u_view"),
      baseSession(ADMIN_TOKEN, "u_admin"),
      baseSession(RATE_TOKEN, "u_ratelimit"),
    ],
    loginEvents: [],
    reports: [],
  } as unknown as Parameters<typeof resetDB>[0]);
  g.__motionHeaders = new Map([["user-agent", "test-agent"]]);
  g.__motionSupabase = { user: null };
}

const post = async (token: string, body: unknown): Promise<Response> => {
  g.__motionCookieJar = makeJar([["motion_session", token]]);
  return groupChatsPOST(
    asNextRequest(
      new Request("http://localhost:3000/api/group-chats", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    )
  );
};

after(() => {
  g.__motionSupabase = null;
  g.__motionCookieJar = undefined;
});

test("group chat create refuses candidates who block the creator (either direction)", async () => {
  seed();
  // u_blocked has u_view blocked → 403 naming the handle.
  const res = await post(VIEW_TOKEN, { action: "create", name: "Study crew", memberIds: ["u_blocked"] });
  assert.equal(res.status, 403);
  const body = (await res.json()) as { error?: string };
  assert.match(body.error ?? "", /blockedme/);
  // u_view blocks u_blocked2 → same 403.
  const res2 = await post(VIEW_TOKEN, { action: "create", name: "Study crew", memberIds: ["u_blocked2"] });
  assert.equal(res2.status, 403);
  // Deactivated accounts cannot be invited.
  const res3 = await post(VIEW_TOKEN, { action: "create", name: "Study crew", memberIds: ["u_deactivated"] });
  assert.equal(res3.status, 403);
  // Control: a clean candidate is accepted.
  const ok = await post(VIEW_TOKEN, { action: "create", name: "Study crew", memberIds: ["u_ok"] });
  assert.equal(ok.status, 200);
});

test("group chat create screens name and description server-side", async () => {
  seed();
  const res = await post(VIEW_TOKEN, { action: "create", name: "Send me your password now", memberIds: [] });
  assert.equal(res.status, 422);
  const body = (await res.json()) as { error?: string };
  assert.match(body.error ?? "", /password/i);
});

test("group chat create rejects rosters over the 20-member cap", async () => {
  seed();
  const res = await post(VIEW_TOKEN, { action: "create", name: "Big", memberIds: Array.from({ length: 21 }, (_, i) => `u_ok_${i}`) });
  assert.equal(res.status, 403);
  const body = (await res.json()) as { error?: string };
  assert.match(body.error ?? "", /limited to 20/);
});

test("group addMembers is admins-only and enforces blocked-pair governance", async () => {
  seed();
  // Non-admin (u_view is a plain member of g_open) must not add members.
  const res = await post(VIEW_TOKEN, { action: "addMembers", groupId: "g_open", memberIds: ["u_ok"] });
  assert.equal(res.status, 403);
  assert.match((await res.json() as { error?: string }).error ?? "", /Only group admins/);
  // Admin attempts to add someone blocked with an existing member (u_gatekeeper blocked u_newcomer).
  const res2 = await post(ADMIN_TOKEN, { action: "addMembers", groupId: "g_open", memberIds: ["u_newcomer"] });
  assert.equal(res2.status, 403);
  assert.match((await res2.json() as { error?: string }).error ?? "", /blocked/);
  // Admin adds a clean candidate successfully, and the cap binds.
  const res3 = await post(ADMIN_TOKEN, { action: "addMembers", groupId: "g_open", memberIds: ["u_ok"] });
  assert.equal(res3.status, 200);
  const cap = await post(ADMIN_TOKEN, { action: "addMembers", groupId: "g_full", memberIds: ["u_ok"] });
  assert.equal(cap.status, 403);
  assert.match((await cap.json() as { error?: string }).error ?? "", /limited to 20/);
});

test("POST /api/connections is throttled after 10 writes per minute", async () => {
  seed();
  g.__motionCookieJar = makeJar([["motion_session", RATE_TOKEN]]);
  const req = () =>
    connectionsPOST(
      asNextRequest(
        new Request("http://localhost:3000/api/connections", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "connect", targetId: "u_ok" }),
        })
      )
    );
  for (let i = 0; i < 10; i += 1) {
    const res = await req();
    assert.notEqual(res.status, 429, `call ${i + 1} must pass the limiter`);
  }
  const rejected = await req();
  assert.equal(rejected.status, 429);
  assert.match(rejected.headers.get("retry-after") ?? "", /^\d+$/);
});

test("POST /api/groups is throttled after 10 writes per minute", async () => {
  seed();
  g.__motionCookieJar = makeJar([["motion_session", RATE_TOKEN]]);
  const req = () =>
    groupsPOST(
      asNextRequest(
        new Request("http://localhost:3000/api/groups", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "join", groupId: "does-not-exist" }),
        })
      )
    );
  for (let i = 0; i < 10; i += 1) {
    const res = await req();
    assert.notEqual(res.status, 429);
  }
  const rejected = await req();
  assert.equal(rejected.status, 429);
});

test("PATCH /api/notifications is throttled after 6 writes per minute", async () => {
  seed();
  g.__motionCookieJar = makeJar([["motion_session", RATE_TOKEN]]);
  const req = () =>
    notificationsPATCH(
      asNextRequest(
        new Request("http://localhost:3000/api/notifications", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        })
      )
    );
  for (let i = 0; i < 6; i += 1) {
    const res = await req();
    assert.notEqual(res.status, 429);
  }
  const rejected = await req();
  assert.equal(rejected.status, 429);
});

test("POST /api/session login attempts are throttled per target handle", async () => {
  seed();
  g.__motionCookieJar = makeJar([["motion_session", RATE_TOKEN]]);
  const attempt = () =>
    sessionPOST(
      asNextRequest(
        new Request("http://localhost:3000/api/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: "login", handle: "okayuser", password: "wrong-password" }),
        })
      )
    );
  for (let i = 0; i < 8; i += 1) {
    const res = await attempt();
    assert.equal(res.status, 401, "bad-password attempts stay 401 until the limiter trips");
  }
  const rejected = await attempt();
  assert.equal(rejected.status, 429);
  // A DIFFERENT victim handle has its own bucket (per-identity throttling).
  const other = await sessionPOST(
    asNextRequest(
      new Request("http://localhost:3000/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "login", handle: "okayuser2", password: "wrong-password" }),
      })
    )
  );
  assert.equal(other.status, 401);
});

test("PATCH /api/settings writes are throttled", async () => {
  seed();
  g.__motionCookieJar = makeJar([["motion_session", RATE_TOKEN]]);
  const req = () =>
    settingsPATCH(
      asNextRequest(
        new Request("http://localhost:3000/api/settings", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        })
      )
    );
  for (let i = 0; i < 30; i += 1) {
    const res = await req();
    assert.notEqual(res.status, 429);
  }
  const rejected = await req();
  assert.equal(rejected.status, 429);
});

test("PATCH /api/admin/reports actions are throttled for staff too", async () => {
  seed();
  g.__motionCookieJar = makeJar([["motion_session", ADMIN_TOKEN]]);
  const req = () =>
    adminReportsPATCH(
      asNextRequest(
        new Request("http://localhost:3000/api/admin/reports", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reportId: "missing", action: "dismiss" }),
        })
      )
    );
  for (let i = 0; i < 30; i += 1) {
    const res = await req();
    assert.notEqual(res.status, 429);
  }
  const rejected = await req();
  assert.equal(rejected.status, 429);
});
