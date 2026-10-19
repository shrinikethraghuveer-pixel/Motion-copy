import { test } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Profile-visibility regression coverage for audit finding P1.
//
// LAYERS OF VERIFICATION:
//   Part A mirrors the SQL policy/helper logic (can_view_profile and
//   search_discoverable_profiles) in TypeScript and asserts the visibility
//   truth table. These are MOCKED policy checks: they document and pin the
//   intended semantics, but they are NOT PostgreSQL RLS verification. Real
//   RLS behavior must be verified against an applied Supabase project.
//   Part B exercises the client search path through a stubbed browser
//   Supabase client (dm-backends.searchUsers), incl. fallback behavior.
//   Part C exercises the /api/users/suggested route through the stubbed
//   server Supabase client and the legacy JSON-store fallback.
// ---------------------------------------------------------------------------

Object.assign(process.env, {
  NODE_ENV: "test",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-test-not-a-secret",
});

/* ========================================================================== */
/* Part A — mocked policy-model checks (NOT live RLS verification)            */
/* ========================================================================== */

/** Rows shaped like public.profiles (subset used by policy + search helper). */
interface ProfileRowModel {
  id: string;
  username: string;
  full_name: string | null;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  is_deactivated: boolean;
}

interface PolicyDB {
  profiles: ProfileRowModel[];
  user_settings: Record<string, { is_private?: boolean; campus_discovery?: boolean }>;
  user_blocks: Array<{ blocker_id: string; blocked_id: string }>;
  connections: Array<{ requester_id: string; target_id: string; status: string }>;
}

/**
 * Mirror of public.can_view_profile (schema.sql / migration 0011).
 * Keep in lockstep with the SQL; a divergence here means a policy drift.
 */
function canViewProfile(ownerId: string, viewerId: string | null, db: PolicyDB): boolean {
  if (viewerId !== null && ownerId === viewerId) return true;
  const deactivated = db.profiles.some((p) => p.id === ownerId && p.is_deactivated);
  if (deactivated) return false;
  const blockedEither = db.user_blocks.some(
    (b) => (b.blocker_id === ownerId && b.blocked_id === viewerId) || (b.blocker_id === viewerId && b.blocked_id === ownerId)
  );
  if (blockedEither) return false;
  const settingsRow = db.user_settings[ownerId];
  const isPrivate = Boolean(settingsRow && settingsRow.is_private);
  if (!isPrivate) return true;
  return db.connections.some(
    (c) =>
      c.status === "accepted" &&
      ((c.requester_id === ownerId && c.target_id === viewerId) ||
        (c.requester_id === viewerId && c.target_id === ownerId))
  );
}

/**
 * Mirror of public.search_discoverable_profiles (migration 0015).
 * Viewer is always the caller's auth.uid(); anon (null) gets zero rows.
 */
function searchDiscoverableProfiles(
  searchText: string,
  rawLimit: number | null,
  viewerId: string | null,
  db: PolicyDB
): ProfileRowModel[] {
  const limit = Math.min(Math.max(rawLimit ?? 10, 1), 30);
  const needle = searchText.toLowerCase();
  return db.profiles
    .filter((p) => {
      if (viewerId === null) return false;
      if (p.id === viewerId) return false;
      const settingsRow = db.user_settings[p.id];
      if (settingsRow && settingsRow.campus_discovery === false) return false;
      if (p.is_deactivated) return false;
      if (
        db.user_blocks.some(
          (b) => (b.blocker_id === p.id && b.blocked_id === viewerId) || (b.blocker_id === viewerId && b.blocked_id === p.id)
        )
      )
        return false;
      const matchesHandle = p.username.toLowerCase().includes(needle);
      const matchesName = (p.full_name ?? "").toLowerCase().includes(needle);
      if (needle === "") return true; // '%%' matches any non-null text.
      return matchesHandle || matchesName;
    })
    .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
    .slice(0, limit);
}

const VIEWER = "22222222-2222-2222-2222-222222222222";
const baseProfile = (over: Partial<ProfileRowModel>): ProfileRowModel => ({
  id: over.id ?? "p_" + Math.random().toString(36).slice(2, 8),
  username: "person",
  full_name: "Person Personson",
  display_name: "Person",
  avatar_url: null,
  created_at: "2026-01-01T00:00:00Z",
  is_deactivated: false,
  ...over,
});

function policyDb(over: Partial<PolicyDB> = {}): PolicyDB {
  return { profiles: [], user_settings: {}, user_blocks: [], connections: [], ...over };
}

test("public profile is visible to anonymous and signed-in viewers", () => {
  const db = policyDb({ profiles: [baseProfile({ id: "pub1", username: "publicp" })] });
  assert.equal(canViewProfile("pub1", null, db), true);
  assert.equal(canViewProfile("pub1", VIEWER, db), true);
  assert.equal(searchDiscoverableProfiles("publicp", 10, null, db).length, 0);
  assert.equal(searchDiscoverableProfiles("publicp", 10, VIEWER, db).length, 1);
});

test("locked (private) profile: header hidden from non-connected, content withheld; still listed in search", () => {
  const db = policyDb({
    profiles: [baseProfile({ id: "priv1", username: "privp" })],
    user_settings: { priv1: { is_private: true, campus_discovery: true } },
  });
  assert.equal(canViewProfile("priv1", null, db), false);
  assert.equal(canViewProfile("priv1", VIEWER, db), false);
  assert.equal(searchDiscoverableProfiles("", 10, VIEWER, db).length, 1);
});

test("locked profile becomes visible to accepted connections (and self)", () => {
  const db = policyDb({
    profiles: [baseProfile({ id: "priv2", username: "priv2" })],
    user_settings: { priv2: { is_private: true } },
    connections: [{ requester_id: "priv2", target_id: VIEWER, status: "accepted" }],
  });
  assert.equal(canViewProfile("priv2", VIEWER, db), true);
  assert.equal(canViewProfile("priv2", "priv2", db), true);
  const pending = policyDb({
    profiles: [baseProfile({ id: "priv3", username: "priv3" })],
    user_settings: { priv3: { is_private: true } },
    connections: [{ requester_id: "priv3", target_id: VIEWER, status: "pending" }],
  });
  assert.equal(canViewProfile("priv3", VIEWER, pending), false);
});

test("blocked profiles are hidden in both directions, even when connected", () => {
  const db = policyDb({
    profiles: [baseProfile({ id: "blk1", username: "blk1" })],
    user_blocks: [{ blocker_id: "blk1", blocked_id: VIEWER }],
    connections: [{ requester_id: "blk1", target_id: VIEWER, status: "accepted" }],
  });
  assert.equal(canViewProfile("blk1", VIEWER, db), false);
  assert.equal(searchDiscoverableProfiles("blk1", 10, VIEWER, db).length, 0);
  // Viewer blocked the target: profile denied and excluded from search too.
  const db2 = policyDb({
    profiles: [baseProfile({ id: "blk2", username: "blk2" })],
    user_blocks: [{ blocker_id: VIEWER, blocked_id: "blk2" }],
  });
  assert.equal(canViewProfile("blk2", VIEWER, db2), false);
  assert.equal(searchDiscoverableProfiles("blk2", 10, VIEWER, db2).length, 0);
});

test("deactivated profiles are hidden from every non-self viewer and from search", () => {
  const db = policyDb({ profiles: [baseProfile({ id: "dea1", username: "dea1", is_deactivated: true })] });
  assert.equal(canViewProfile("dea1", VIEWER, db), false);
  assert.equal(canViewProfile("dea1", null, db), false);
  assert.equal(searchDiscoverableProfiles("dea1", 10, VIEWER, db).length, 0);
});

test("own profile stays accessible even if private, discovered-off, or deactivated", () => {
  const own: PolicyDB = {
    profiles: [baseProfile({ id: VIEWER, username: "selfp", is_deactivated: true })],
    user_settings: { [VIEWER]: { is_private: true, campus_discovery: false } },
    user_blocks: [],
    connections: [],
  };
  assert.equal(canViewProfile(VIEWER, VIEWER, own), true);
  // Own row must never appear in own search results.
  assert.equal(searchDiscoverableProfiles("selfp", 10, VIEWER, own).length, 0);
});

test("undiscoverable profiles are excluded from search but remain directly viewable", () => {
  const db = policyDb({
    profiles: [baseProfile({ id: "hid1", username: "hid1" })],
    user_settings: { hid1: { campus_discovery: false } },
  });
  assert.equal(canViewProfile("hid1", VIEWER, db), true);
  assert.equal(searchDiscoverableProfiles("hid1", 10, VIEWER, db).length, 0);
});

test("profiles without a user_settings row count as discoverable", () => {
  const db = policyDb({ profiles: [baseProfile({ id: "nos1", username: "nos1" })] });
  assert.equal(searchDiscoverableProfiles("nos1", 10, VIEWER, db).length, 1);
  assert.equal(canViewProfile("nos1", VIEWER, db), true);
});

test("search matches username or full_name, orders newest first, and clamps the limit", () => {
  const db = policyDb({
    profiles: [
      baseProfile({ id: "m1", username: "zoehandle", full_name: " somebody else", created_at: "2026-03-01T00:00:00Z" }),
      baseProfile({ id: "m2", username: "otherperson", full_name: "zoe person", created_at: "2026-02-01T00:00:00Z" }),
      baseProfile({ id: "m3", username: "unrelated", full_name: "no match", created_at: "2026-01-01T00:00:00Z" }),
      baseProfile({ id: "m4", username: "oldermatch", full_name: "zoe again", created_at: "2026-01-02T00:00:00Z" }),
    ],
  });
  const hits = searchDiscoverableProfiles("zoe", 10, VIEWER, db);
  assert.deepEqual(hits.map((r) => r.id), ["m1", "m2", "m4"]);
  const clamped = searchDiscoverableProfiles("", 999, VIEWER, db);
  assert.ok(clamped.length <= 30);
  assert.equal(searchDiscoverableProfiles("nomatchanywhere", 10, VIEWER, db).length, 0);
});

/* ========================================================================== */
/* Part B — dm-backends.searchUsers behavior (stubbed browser client)         */
/* ========================================================================== */

const { searchUsers } = await import("@/lib/dm-backends");

interface SupabaseClientState {
  user?: { id: string };
  rpcError?: { message: string } | null;
  rpcHandlers?: Record<string, (args: Record<string, unknown>) => unknown>;
}

interface TestGlobals {
  __motionSupabase?: Record<string, unknown> | null;
  __motionSupabaseClient?: SupabaseClientState | null;
  __motionCookieJar?: Map<string, string>;
  __motionHeaders?: Map<string, string>;
}

const g = globalThis as typeof globalThis & TestGlobals;

type FetchSpy = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
const originalFetch = globalThis.fetch;
let fetchCalls: Array<{ url: string }> = [];

function stubFetch(respond: (url: string) => unknown | null): void {
  const spy: FetchSpy = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    fetchCalls.push({ url });
    const body = respond(url);
    if (body === null) return new Response(JSON.stringify({ error: "Not signed in." }), { status: 401 });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  globalThis.fetch = spy as unknown as typeof fetch;
}

test.after(() => {
  globalThis.fetch = originalFetch;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  g.__motionSupabaseClient = null;
});

function rpcRow(over: Record<string, unknown>): Record<string, unknown> {
  return { id: "row", username: "rowhandle", full_name: null, display_name: null, avatar_url: null, ...over };
}

test("searchUsers routes through the discovery RPC and maps profile rows", async () => {
  let capturedArgs: Record<string, unknown> | null = null;
  g.__motionSupabaseClient = {
    user: { id: VIEWER },
    rpcHandlers: {
      search_discoverable_profiles: (args) => {
        capturedArgs = args as Record<string, unknown>;
        return [
          rpcRow({ id: "r1", username: "zoecodes", display_name: "Zoe R.", avatar_url: "https://cdn.test/zoe.png" }),
          rpcRow({ id: "r2", username: "second", full_name: "Full Name" }),
        ];
      },
    },
  };
  fetchCalls = [];
  stubFetch(() => null);
  const users = await searchUsers("zoe");
  assert.deepEqual(capturedArgs, { p_search_text: "zoe", p_result_limit: 10 });
  assert.equal(fetchCalls.length, 0);
  assert.equal(users[0].id, "r1");
  assert.equal(users[0].handle, "zoecodes");
  assert.equal(users[0].name, "Zoe R.");
  assert.equal(users[0].photo, "https://cdn.test/zoe.png");
  assert.equal(users[1].name, "Full Name");
});

test("searchUsers strips ilike wildcards before calling the RPC", async () => {
  let capturedArgs: Record<string, unknown> | null = null;  g.__motionSupabaseClient = {
    user: { id: VIEWER },
    rpcHandlers: {
      search_discoverable_profiles: (args: Record<string, unknown>) => {
        capturedArgs = args;
        return [];
      },
    },
  };
  await searchUsers("zo_e%s%");
  assert.equal(capturedArgs?.["p_search_text"], "zoes");
});

test("searchUsers falls back to the legacy search API when signed out of Supabase", async () => {
  g.__motionSupabaseClient = {};
  fetchCalls = [];
  stubFetch((url) =>
    url.includes("/api/users/search")
      ? { users: [{ id: "u_local", handle: "localuser", name: "Local" }] }
      : null
  );
  const users = await searchUsers("anything");
  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0].url, /\/api\/users\/search\?q=anything/);
  assert.equal(users[0].id, "u_local");
});

test("searchUsers falls back to the legacy search API when the RPC errors", async () => {
  g.__motionSupabaseClient = { user: { id: VIEWER }, rpcError: { message: "RPC unavailable." } };
  fetchCalls = [];
  stubFetch((url) =>
    url.includes("/api/users/search") ? { users: [{ id: "u_local2", handle: "l2", name: "L2" }] } : null
  );
  const users = await searchUsers("l2");
  assert.equal(fetchCalls.length, 1);
  assert.equal(users[0].id, "u_local2");
});

test("searchUsers short-circuits on empty input without touching any backend", async () => {
  g.__motionSupabaseClient = null;
  fetchCalls = [];
  stubFetch(() => null);
  const users = await searchUsers("   ");
  assert.deepEqual(users, []);
  assert.equal(fetchCalls.length, 0);
});

/* ========================================================================== */
/* Part C — /api/users/suggested route (stubbed server client + fallback)     */
/* ========================================================================== */

test("users/suggested local fallback excludes blocked users in both directions", async () => {
  const { resetDB } = await import("./stubs/db-stub.mjs");
  const now = new Date().toISOString();
  resetDB({
    users: [
      { id: "u_me", handle: "me", name: "Me", deactivatedAt: null, settings: { blocked: ["u_theyarehidden2"] }, skills: [], following: [] },
      // They blocked the viewer → hidden even though they stay discoverable.
      { id: "u_theyarehidden", handle: "blockedme", name: "Blocked Me", deactivatedAt: null, settings: { blocked: ["u_me"], discoverable: true }, skills: [], following: [] },
      // The viewer blocked them → hidden too.
      { id: "u_theyarehidden2", handle: "iblockedthem", name: "IBlocked Them", deactivatedAt: null, settings: { discoverable: true }, skills: [], following: [] },
      { id: "u_open", handle: "open", name: "Open", deactivatedAt: null, skills: [], following: [] },
    ],
    connections: [],
    chats: [],
    dmGroups: [],
    posts: [],
    groups: [],
    notifications: [],
    sessions: [{ token: "s_testsuggtoken2", userId: "u_me", device: "test", createdAt: now, lastSeenAt: now }],
    loginEvents: [],
    reports: [],
  } as unknown as Parameters<typeof resetDB>[0]);
  const jar = makeJar([["motion_session", "s_testsuggtoken2"]]);
  g.__motionCookieJar = jar as unknown as Map<string, string>;
  g.__motionHeaders = new Map([["user-agent", "test-agent"]]);
  g.__motionSupabase = { user: null };
  try {
    const res = await suggestedRoute(new Request("http://localhost:3000/api/users/suggested?limit=5"));
    const body = (await res.json()) as { users: Array<{ id: string }> };
    assert.equal(res.status, 200);
    assert.ok(body.users.some((u) => u.id === "u_open"), "control user must still be suggested");
    // Either direction of blocking removes the pair from both the primary and
    // the relaxed (<3 candidates) suggestion path.
    assert.ok(!body.users.some((u) => u.id === "u_theyarehidden"), "user who blocked the viewer must not be suggested");
    assert.ok(!body.users.some((u) => u.id === "u_theyarehidden2"), "user the viewer blocked must not be suggested");
    assert.ok(!body.users.some((u) => u.id === "u_me"), "self must never be suggested");
  } finally {
    g.__motionSupabase = null;
  }
});

test("users/suggested under the candidate cap (relaxed path) still excludes blocked users", async () => {
  const { resetDB } = await import("./stubs/db-stub.mjs");
  const now = new Date().toISOString();
  resetDB({
    users: [
      { id: "u_me", handle: "me", name: "Me", deactivatedAt: null, settings: { blocked: ["u_theyarehidden2"] }, skills: [], following: [] },
      // Sparse community: fewer than three candidates, so the widget runs its
      // "keep useful" relaxed branch — blocks must survive the relaxation.
      { id: "u_theyarehidden", handle: "blockedme", name: "Blocked Me", deactivatedAt: null, settings: { blocked: ["u_me"], discoverable: true }, skills: [], following: [] },
      { id: "u_theyarehidden2", handle: "iblockedthem", name: "IBlocked Them", deactivatedAt: null, settings: { discoverable: true }, skills: [], following: [] },
      { id: "u_open", handle: "open", name: "Open", deactivatedAt: null, skills: [], following: [] },
    ],
    connections: [],
    chats: [],
    dmGroups: [],
    posts: [],
    groups: [],
    notifications: [],
    sessions: [{ token: "s_testsuggtoken3", userId: "u_me", device: "test", createdAt: now, lastSeenAt: now }],
    loginEvents: [],
    reports: [],
  } as unknown as Parameters<typeof resetDB>[0]);
  const jar = makeJar([["motion_session", "s_testsuggtoken3"]]);
  g.__motionCookieJar = jar as unknown as Map<string, string>;
  g.__motionHeaders = new Map([["user-agent", "test-agent"]]);
  g.__motionSupabase = { user: null };
  try {
    const res = await suggestedRoute(new Request("http://localhost:3000/api/users/suggested?limit=5"));
    const body = (await res.json()) as { users: Array<{ id: string }> };
    assert.equal(res.status, 200);
    assert.ok(body.users.length < 3, "test must exercise the relaxed sparse branch");
    assert.ok(!body.users.some((u) => u.id === "u_theyarehidden"));
    assert.ok(!body.users.some((u) => u.id === "u_theyarehidden2"));
    assert.ok(!body.users.some((u) => u.id === "u_me"));
  } finally {
    g.__motionSupabase = null;
  }
});

function makeJar(stored: Array<[string, string]>): { get: (name: string) => { name: string; value: string } | undefined; set: (name: string, value: string) => void; store: Map<string, string> } {
  const store = new Map(stored);
  return {
    get(name: string) {
      const value = store.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set(name: string, value: string) {
      store.set(name, value);
    },
    store,
  };
}

const { GET: suggestedRoute } = (await import("@/app/api/users/suggested/route")) as {
  GET: (request: Request) => Promise<Response>;
};

test("users/suggested uses the discovery RPC, excludes connected/self, and relaxes when sparse", async (t) => {
  const dbUsers = [
    { id: "u_local", handle: "localuser", name: "Local User", deactivatedAt: null, skills: [], following: [] },
  ];
  const now = new Date().toISOString();
  const { resetDB } = await import("./stubs/db-stub.mjs");
  resetDB({
    users: dbUsers,
    connections: [],
    chats: [],
    dmGroups: [],
    posts: [],
    groups: [],
    notifications: [],
    sessions: [{ token: "s_testsuggtoken0", userId: "u_local", device: "test", createdAt: now, lastSeenAt: now }],
    loginEvents: [],
    reports: [],
  } as unknown as Parameters<typeof resetDB>[0]);
  const jar = makeJar([["motion_session", "s_testsuggtoken0"]]);
  g.__motionCookieJar = jar as unknown as Map<string, string>;
  g.__motionHeaders = new Map([["user-agent", "test-agent"]]);

  const candidateRows = [
    { id: "c1", username: "candone", full_name: null, display_name: "Cand One", avatar_url: null, created_at: "2026-04-01T00:00:00Z" },
    { id: "c2", username: "candtwo", full_name: null, display_name: "Cand Two", avatar_url: null, created_at: "2026-03-01T00:00:00Z" },
    { id: "c3", username: "candthree", full_name: null, display_name: "Cand Three", avatar_url: null, created_at: "2026-02-01T00:00:00Z" },
    { id: "c4", username: "candfour", full_name: null, display_name: "Cand Four", avatar_url: null, created_at: "2026-01-01T00:00:00Z" },
  ];

  // Case 1: three discoverable candidates after excluding a connected one.
  g.__motionSupabase = {
    user: { id: "88888888-8888-8888-8888-888888888888" },
    rows: { connections: [{ requester_id: "88888888-8888-8888-8888-888888888888", target_id: "c2", status: "accepted" }] },
    rpcHandlers: {
      search_discoverable_profiles: (args: Record<string, unknown>) => {
        assert.deepEqual(args, { p_search_text: "", p_result_limit: 25 });
        return candidateRows;
      },
    },
  };
  const res = await suggestedRoute(new Request("http://localhost:3000/api/users/suggested?limit=5"));
  const body = (await res.json()) as { users: Array<{ id: string; handle: string; name: string }> };
  assert.equal(res.status, 200);
  assert.deepEqual(
    body.users.map((u) => u.id),
    ["c1", "c3", "c4"]
  );
  assert.equal(body.users[0].handle, "candone");

  // Case 2: fewer than three candidates → relaxed departure (no connection filter).
  g.__motionSupabase = {
    user: { id: "88888888-8888-8888-8888-888888888888" },
    rows: { connections: [] },
    rpcHandlers: {
      search_discoverable_profiles: () => candidateRows.slice(0, 2),
    },
  };
  const res2 = await suggestedRoute(new Request("http://localhost:3000/api/users/suggested?limit=5"));
  const body2 = (await res2.json()) as { users: Array<{ id: string }> };
  assert.deepEqual(body2.users.map((u) => u.id), ["c1", "c2"]);
});

test("users/suggested local fallback filters undiscoverable and deactivated profiles", async () => {
  const { resetDB } = await import("./stubs/db-stub.mjs");
  const now = new Date().toISOString();
  resetDB({
    users: [
      { id: "u_me", handle: "me", name: "Me", deactivatedAt: null, skills: [], following: [] },
      { id: "u_hidden", handle: "hidden", name: "Hidden", deactivatedAt: null, settings: { discoverable: false }, skills: [], following: [] },
      { id: "u_gone", handle: "gone", name: "Gone", deactivatedAt: now, skills: [], following: [] },
      { id: "u_visible", handle: "visible", name: "Visible", deactivatedAt: null, skills: [], following: [] },
    ],
    connections: [],
    chats: [],
    dmGroups: [],
    posts: [],
    groups: [],
    notifications: [],
    sessions: [{ token: "s_testsuggtoken1", userId: "u_me", device: "test", createdAt: now, lastSeenAt: now }],
    loginEvents: [],
    reports: [],
  } as unknown as Parameters<typeof resetDB>[0]);
  const jar = makeJar([["motion_session", "s_testsuggtoken1"]]);
  g.__motionCookieJar = jar as unknown as Map<string, string>;
  g.__motionHeaders = new Map([["user-agent", "test-agent"]]);

  // No Supabase session/environment → route resolves candidates from the
  // local store, which enforces discoverable + deactivation itself.
  const prev = g.__motionSupabase;
  g.__motionSupabase = { user: null };
  try {
    const res = await suggestedRoute(new Request("http://localhost:3000/api/users/suggested?limit=5"));
    const body = (await res.json()) as { users: Array<{ id: string }> };
    assert.equal(res.status, 200);
    assert.ok(body.users.some((u) => u.id === "u_visible"));
    assert.ok(!body.users.some((u) => u.id === "u_hidden"));
    assert.ok(!body.users.some((u) => u.id === "u_gone"));
    assert.ok(!body.users.some((u) => u.id === "u_me"));
  } finally {
    g.__motionSupabase = prev;
  }
});
