import { test, after } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Audit P8 bounds: every list endpoint caps its payload (default) and honors
// a `limit` query parameter up to a hard maximum. Legacy JSON store-backed
// routes; Supabase RLS/limit parity is a deployment-verification item.
// ---------------------------------------------------------------------------

Object.assign(process.env, {
  NODE_ENV: "test",
  MOTION_ADMIN_EMAILS: "admin@test.local",
});
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

import { resetDB } from "./stubs/db-stub.mjs";
import { asNextRequest, baseSession, globals, localUser, makeJar } from "./helpers/route-test.ts";

const { GET: postsGET } = (await import("@/app/api/posts/route")) as unknown as {
  GET: (request: Request) => Promise<Response>;
};
const { GET: userGET } = (await import("@/app/api/users/[handle]/route")) as unknown as {
  GET: (request: Request, ctx: { params: Promise<{ handle: string }> }) => Promise<Response>;
};
const { GET: notificationsGET } = (await import("@/app/api/notifications/route")) as unknown as {
  GET: (request: Request) => Promise<Response>;
};
const { GET: groupsGET } = (await import("@/app/api/groups/route")) as unknown as {
  GET: (request: Request) => Promise<Response>;
};
const { GET: mySpaceGET } = (await import("@/app/api/my-space/route")) as unknown as {
  GET: (request: Request) => Promise<Response>;
};
const { GET: reportsGET } = (await import("@/app/api/admin/reports/route")) as unknown as {
  GET: (request: Request) => Promise<Response>;
};

const g = globals();

const VIEWER = "u_view";
const AUTHOR = "u_author";
const VIEW_TOKEN = "s_p8viewtoken1";
const ADMIN_TOKEN = "s_p8admintoken1";
const now = new Date().toISOString();

function post(id: string, authorId: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, authorId, type: "social", text: `post ${id}`, media: null, likes: [], reposts: [], comments: [], savedBy: [], event: null, createdAt: now, ...over };
}

function notification(id: string): Record<string, unknown> {
  return { id, userId: VIEWER, type: "like", actorId: AUTHOR, postId: "p_1", text: "x", read: false, createdAt: now };
}

function group(id: string): Record<string, unknown> {
  return { id, name: `Group ${id}`, tag: "t", description: "d", school: null, createdAt: now, members: [{ userId: AUTHOR, role: "admin", joinedAt: now }], joinRequests: [], posts: [] };
}

function report(id: string): Record<string, unknown> {
  return { id, reporterId: VIEWER, targetType: "post", targetId: `p_${id}`, reason: "spam", createdAt: now };
}

function seed(): void {
  resetDB({
    users: [
      localUser(VIEWER, "viewer", { email: "admin@test.local" }),
      localUser(AUTHOR, "postwriter"),
    ],
    connections: [],
    chats: [],
    dmGroups: [],
    posts: Array.from({ length: 150 }, (_, i) => post(`p_${i}`, AUTHOR)),
    groups: Array.from({ length: 150 }, (_, i) => group(`g_${i}`)),
    notifications: Array.from({ length: 250 }, (_, i) => notification(`n_${i}`)),
    sessions: [baseSession(VIEW_TOKEN, VIEWER), baseSession(ADMIN_TOKEN, VIEWER)],
    loginEvents: [],
    reports: Array.from({ length: 130 }, (_, i) => report(`r_${i}`)),
  } as unknown as Parameters<typeof resetDB>[0]);
  g.__motionHeaders = new Map([["user-agent", "test-agent"]]);
  g.__motionSupabase = { user: null };
}

const jarFor = (token: string) => {
  g.__motionCookieJar = makeJar([["motion_session", token]]);
};

after(() => {
  g.__motionSupabase = null;
  g.__motionCookieJar = undefined;
});

test("GET /api/posts caps history: default 50, ?limit honored to hard cap 100", async () => {
  seed();
  jarFor(VIEW_TOKEN);
  const def = (await (await postsGET(new Request("http://localhost:3000/api/posts?tab=author&author=postwriter"))).json()) as { posts: unknown[] };
  assert.equal(def.posts.length, 50);
  const five = (await (await postsGET(new Request("http://localhost:3000/api/posts?tab=author&author=postwriter&limit=5"))).json()) as { posts: unknown[] };
  assert.equal(five.posts.length, 5);
  const capped = (await (await postsGET(new Request("http://localhost:3000/api/posts?tab=author&author=postwriter&limit=5000"))).json()) as { posts: unknown[] };
  assert.equal(capped.posts.length, 100);
  const zero = (await (await postsGET(new Request("http://localhost:3000/api/posts?tab=author&author=postwriter&limit=0"))).json()) as { posts: unknown[] };
  assert.ok(zero.posts.length >= 1, "limit=0 is clamped, not empty");
});

test("GET /api/users/[handle] caps profile posts: default 30, ?limit to hard cap 100", async () => {
  seed();
  jarFor(VIEW_TOKEN);
  const def = await userGET(asNextRequest(new Request("http://localhost:3000/api/users/postwriter")), { params: Promise.resolve({ handle: "postwriter" }) });
  const defBody = (await def.json()) as { posts: unknown[]; stats: { posts: number } };
  assert.equal(defBody.posts.length, 30);
  const five = await userGET(asNextRequest(new Request("http://localhost:3000/api/users/postwriter?limit=5")), { params: Promise.resolve({ handle: "postwriter" }) });
  assert.equal(((await five.json()) as { posts: unknown[] }).posts.length, 5);
  const capped = await userGET(asNextRequest(new Request("http://localhost:3000/api/users/postwriter?limit=9999")), { params: Promise.resolve({ handle: "postwriter" }) });
  const cappedBody = (await capped.json()) as { posts: unknown[]; stats: { posts: number } };
  assert.equal(cappedBody.posts.length, 100);
  // Stats still report the full history size (not truncated) for the page header.
  assert.equal(cappedBody.stats.posts, 150);
});

test("GET /api/notifications caps: default 100, ?limit to hard cap 200", async () => {
  seed();
  jarFor(VIEW_TOKEN);
  const def = (await (await notificationsGET(new Request("http://localhost:3000/api/notifications"))).json()) as { notifications: unknown[] };
  assert.equal(def.notifications.length, 100);
  const three = (await (await notificationsGET(new Request("http://localhost:3000/api/notifications?limit=3"))).json()) as { notifications: unknown[] };
  assert.equal(three.notifications.length, 3);
  const capped = (await (await notificationsGET(new Request("http://localhost:3000/api/notifications?limit=99999"))).json()) as { notifications: unknown[] };
  assert.equal(capped.notifications.length, 200);
});

test("GET /api/groups caps: default 60, ?limit to hard cap 120", async () => {
  seed();
  jarFor(VIEW_TOKEN);
  const def = (await (await groupsGET(new Request("http://localhost:3000/api/groups"))).json()) as { groups: unknown[] };
  assert.equal(def.groups.length, 60);
  const ten = (await (await groupsGET(new Request("http://localhost:3000/api/groups?limit=10"))).json()) as { groups: unknown[] };
  assert.equal(ten.groups.length, 10);
  const capped = (await (await groupsGET(new Request("http://localhost:3000/api/groups?limit=4000"))).json()) as { groups: unknown[] };
  assert.equal(capped.groups.length, 120);
});

test("GET /api/my-space caps classmates at 50", async () => {
  const classmates = Array.from({ length: 80 }, (_, i) => localUser(`u_cls_${i}`, `cls${i}`));
  resetDB({
    users: [localUser(VIEWER, "viewer"), ...classmates],
    connections: [],
    chats: [],
    dmGroups: [],
    posts: [],
    groups: [],
    notifications: [],
    sessions: [baseSession(VIEW_TOKEN, VIEWER)],
    loginEvents: [],
    reports: [],
  } as unknown as Parameters<typeof resetDB>[0]);
  jarFor(VIEW_TOKEN);
  const res = await mySpaceGET(new Request("http://localhost:3000/api/my-space"));
  const body = (await res.json()) as { classmates: unknown[] };
  assert.equal(res.status, 200);
  assert.equal(body.classmates.length, 50);
});

test("GET /api/admin/reports (local mode) caps the queue at 100 to match Supabase mode", async () => {
  seed();
  jarFor(ADMIN_TOKEN);
  const res = await reportsGET(new Request("http://localhost:3000/api/admin/reports"));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { reports?: unknown[] };
  assert.equal(body.reports?.length, 100);
});
