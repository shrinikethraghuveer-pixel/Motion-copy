import { test } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Regression coverage for audit remediation P2 (media/avatar URL validation).
//
// LAYERS OF VERIFICATION:
//   Part A unit-tests the shared validator (src/lib/url-validation.ts).
//   Part B exercises the legacy API routes (/api/posts, /api/groups,
//   /api/group-chats, /api/groups/[id], /api/settings) against the stubbed
//   JSON store, asserting user-supplied URLs are validated before persistence
//   and that records stored by OLDER app versions remain valid on read.
//   Part C exercises the browser-plane mirrors (dm-backends.createGroup,
//   db/profiles.updateOwnProfile) which write directly through RLS in
//   Supabase mode.
// Everything is mocked; no live network requests, and these regression tests
// are NOT a claim that the whole backend is security-complete.
// ---------------------------------------------------------------------------

Object.assign(process.env, {
  NODE_ENV: "test",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-test-not-a-secret",
});

const g = globalThis as unknown as Record<string, unknown>;

let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
function stubFetch(responder: (url: string, init?: RequestInit) => unknown) {
  fetchCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(typeof input === "object" && input !== null && "url" in input ? (input as Request).url : input);
    fetchCalls.push({ url, init });
    const payload = responder(url, init);
    if (payload === null || payload === undefined) return new Response(JSON.stringify({ error: "unstubbed" }), { status: 404 });
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

function makeJar(stored: Array<[string, string]>) {
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

/* ========================================================================== */
/* Part A â€” shared validator unit tests                                        */
/* ========================================================================== */

const { validateMediaUrl, validateOptionalUrl, validateMediaUrlList, validateExternalLink } =
  (await import("@/lib/url-validation")) as Awaited<typeof import("@/lib/url-validation")>;

test("validateMediaUrl accepts the URLs the app legitimately stores", () => {
  for (const good of [
    "https://example.supabase.co/storage/v1/object/public/post-media/u1/att.png",
    "https://example.supabase.co/storage/v1/object/public/avatars/u1/avatar.webp",
    "https://media.giphy.com/media/abc123/giphy.gif",
    "https://example.com/headshot.jpg",
    "data:image/png;base64,iVBORw0KGgo=",
    "data:video/mp4;base64,AAAAIGZ0eXBpc29t",
    "http://localhost:54321/storage/v1/object/public/avatars/dev.png",
    "http://127.0.0.1:9000/bucket/node.png",
  ]) {
    const result = validateMediaUrl(good);
    assert.equal(result.ok, true, `expected ${good} to be accepted`);
  }
});

test("validateMediaUrl rejects script and dangerous schemes", () => {
  for (const evil of [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "java\tscript:alert(1)",
    "vbscript:msgbox(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "  javascript:alert(1) ",
    "file:///etc/passwd",
    "blob:https://example.com/abc",
    "ftp://example.com/file.png",
    "ws://example.com/socket",
    "not a url at all",
    "https//missing-colon.example.com/x",
  ]) {
    const result = validateMediaUrl(evil);
    assert.equal(result.ok, false, `expected ${evil} to be rejected`);
  }
});

test("validateMediaUrl rejects scripted data payloads (svg/html)", () => {
  assert.equal(validateMediaUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=").ok, false);
  assert.equal(validateMediaUrl("data:text/html,<script>alert(1)</script>").ok, false);
});

test("validateMediaUrl rejects credential-bearing and insecure network URLs", () => {
  assert.equal(validateMediaUrl("https://user:pass@example.com/avatar.png").ok, false);
  assert.equal(validateMediaUrl("https://expected.com%@evil.example/avatar.png").ok, false);
  assert.equal(validateMediaUrl("http://insecure.example.com/avatar.png").ok, false);
});

test("validateMediaUrl enforces URL length limits", () => {
  const longNetwork = `https://example.com/${"a".repeat(3000)}`;
  assert.equal(validateMediaUrl(longNetwork).ok, false);
  const longData = `data:image/png;base64,${"A".repeat(3_000_001)}`;
  assert.equal(validateMediaUrl(longData).ok, false);
});

test("validateMediaUrl rejects non-string values", () => {
  for (const bad of [null, undefined, 42, { url: "https://ok.example/a.png" }, ["https://ok.example/a.png"]]) {
    assert.equal(validateMediaUrl(bad).ok, false, `expected ${String(bad)} to be rejected`);
  }
});

test("validateOptionalUrl maps nullable/empty inputs to null safely", () => {
  for (const empty of [null, undefined, "", "   "]) {
    const result = validateOptionalUrl(empty);
    assert.deepEqual(result, { ok: true, url: null });
  }
  assert.equal(validateOptionalUrl("javascript:alert(1)").ok, false);
  const ok = validateOptionalUrl("  https://ok.example/a.png  ");
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.url?.includes("ok.example"), true);
});

test("validateMediaUrlList is all-or-nothing, drops blanks, and enforces the count cap", () => {
  const good = validateMediaUrlList([
    "https://ok.example/1.png",
    "",
    "  ",
    "data:image/png;base64,iVBORw0KGgo=",
  ]);
  assert.ok(good.ok);
  if (good.ok) {
    assert.equal(good.urls.length, 2);
    assert.equal(good.urls[0], "https://ok.example/1.png");
  }
  assert.equal(validateMediaUrlList(["https://ok.example/1.png", "javascript:alert(1)"]).ok, false);
  assert.equal(
    validateMediaUrlList(Array.from({ length: 5 }, (_, i) => `https://ok.example/${i}.png`)).ok,
    false
  );
  assert.equal(validateMediaUrlList("not-an-array").ok, false);
});

test("validateExternalLink keeps bare-domain input working but blocks schemes", () => {
  const bare = validateExternalLink("github.com/niko");
  assert.ok(bare.ok, "bare domains remain accepted for legacy parity");
  assert.equal(validateExternalLink("https://www.linkedin.com/in/niko").ok, true);
  assert.equal(validateExternalLink("javascript:alert(1)").ok, false);
  assert.equal(validateExternalLink("vbscript:alert(1)").ok, false);
});

/* ========================================================================== */
/* Shared route-harness state                                                  */
/* ========================================================================== */

const now = new Date().toISOString();

function freshDB(users: unknown[], extra: Record<string, unknown> = {}) {
  return {
    users,
    connections: [],
    chats: [],
    dmGroups: [],
    posts: [],
    groups: [],
    notifications: [],
    sessions: [],
    loginEvents: [],
    reports: [],
    ...extra,
  };
}

function seedDB(users: unknown[], sessionToken: string, userId: string, extra: Record<string, unknown> = {}) {
  return freshDB(users, {
    ...extra,
    sessions: [{ token: sessionToken, userId, device: "test", createdAt: now, lastSeenAt: now }],
  });
}

function baseUser(id: string, handle: string) {
  return {
    id,
    handle,
    name: handle,
    deactivatedAt: null,
    school: "Northgate",
    skills: [],
    following: [],
    settings: {},
  };
}

/* ========================================================================== */
/* Part B â€” legacy API routes (stubbed JSON store)                             */
/* ========================================================================== */

const { POST: postsRoute } = (await import("@/app/api/posts/route")) as unknown as {
  POST: (req: Request) => Promise<Response>;
};
const { POST: groupsRoute } = (await import("@/app/api/groups/route")) as unknown as {
  POST: (req: Request) => Promise<Response>;
};
const { POST: groupChatsRoute } = (await import("@/app/api/group-chats/route")) as unknown as {
  POST: (req: Request) => Promise<Response>;
};
const { POST: communityPostRoute } = (await import("@/app/api/groups/[id]/route")) as unknown as {
  POST: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
};
const { PATCH: settingsRoute } = (await import("@/app/api/settings/route")) as unknown as {
  PATCH: (req: Request) => Promise<Response>;
};

async function postJson(routeCall: () => Promise<Response>) {
  const res = await routeCall();
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

test("posts API rejects script-scheme mediaUrls before persistence", async () => {
  const { resetDB, readDB } = await import("./stubs/db-stub.mjs");
  resetDB(seedDB([baseUser("u_posts1", "poster1")], "s_tok_posts1", "u_posts1"));
  g.__motionCookieJar = makeJar([["motion_session", "s_tok_posts1"]]) as unknown as Map<string, string>;
  g.__motionHeaders = new Map([["user-agent", "test-agent"]]);
  g.__motionSupabase = { user: null };
  try {
    const { status, body } = await postJson(() =>
      postsRoute(
        new Request("http://localhost:3000/api/posts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: "check this out", mediaUrls: ["javascript:alert(document.domain)"] }),
        })
      ) as Promise<Response>
    );
    assert.equal(status, 422);
    assert.match(String(body.error ?? body.message ?? ""), /https|media link|URL/i);
    const db = (await readDB()) as unknown as { posts: unknown[] };
    assert.equal(db.posts.length, 0, "nothing was persisted");
  } finally {
    g.__motionCookieJar = null;
    g.__motionSupabase = null;
  }
});

test("posts API stores validated https and raster data URLs and drops blanks", async () => {
  const { resetDB, readDB } = await import("./stubs/db-stub.mjs");
  resetDB(seedDB([baseUser("u_posts2", "poster2")], "s_tok_posts2", "u_posts2"));
  g.__motionCookieJar = makeJar([["motion_session", "s_tok_posts2"]]) as unknown as Map<string, string>;
  g.__motionHeaders = new Map([["user-agent", "test-agent"]]);
  g.__motionSupabase = { user: null };
  try {
    const { status, body } = await postJson(() =>
      postsRoute(
        new Request("http://localhost:3000/api/posts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            text: "my build log",
            mediaUrls: ["", "https://example.supabase.co/storage/v1/object/public/post-media/u/att.png", "data:image/png;base64,iVBORw0KGgo="],
          }),
        })
      ) as Promise<Response>
    );
    assert.equal(status, 201);
    const stored = (body as { post: { mediaUrls: string[] | null } }).post.mediaUrls;
    assert.equal(stored?.length, 2);
    const db = (await readDB()) as unknown as { posts: Array<{ mediaUrls: string[] }> };
    assert.equal(db.posts[0].mediaUrls?.length, 2);
  } finally {
    g.__motionCookieJar = null;
    g.__motionSupabase = null;
  }
});

test("posts API enforces the attachment count and media-type caps", async () => {
  const { resetDB } = await import("./stubs/db-stub.mjs");
  resetDB(seedDB([baseUser("u_posts3", "poster3")], "s_tok_posts3", "u_posts3"));
  g.__motionCookieJar = makeJar([["motion_session", "s_tok_posts3"]]) as unknown as Map<string, string>;
  g.__motionHeaders = new Map([["user-agent", "test-agent"]]);
  g.__motionSupabase = { user: null };
  try {
    const five = Array.from({ length: 5 }, (_, i) => `https://ok.example/${i}.png`);
    const countResult = await postJson(() =>
      postsRoute(
        new Request("http://localhost:3000/api/posts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: "too many", mediaUrls: five }),
        })
      ) as Promise<Response>
    );
    assert.equal(countResult.status, 422);

    const svgResult = await postJson(() =>
      postsRoute(
        new Request("http://localhost:3000/api/posts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: "svg", mediaUrls: ["data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="] }),
        })
      ) as Promise<Response>
    );
    assert.equal(svgResult.status, 422);

    const longResult = await postJson(() =>
      postsRoute(
        new Request("http://localhost:3000/api/posts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: "huge", mediaUrls: [`data:image/png;base64,${"A".repeat(3_000_001)}`] }),
        })
      ) as Promise<Response>
    );
    assert.equal(longResult.status, 422);
  } finally {
    g.__motionCookieJar = null;
    g.__motionSupabase = null;
  }
});

test("records persisted by older app versions stay valid on read and do not break new posts", async () => {
  const { resetDB, readDB } = await import("./stubs/db-stub.mjs");
  resetDB(
    seedDB([baseUser("u_posts4", "poster4")], "s_tok_posts4", "u_posts4", {
      posts: [
        {
          id: "p_legacy",
          authorId: "u_posts4",
          type: "social",
          text: "legacy post with unsafe url from an older version",
          mediaUrls: ["javascript:alert(1)"],
          media: null,
          poll: null,
          likes: [],
          reposts: [],
          comments: [],
          savedBy: [],
          event: null,
          createdAt: now,
        },
      ],
    })
  );
  g.__motionCookieJar = makeJar([["motion_session", "s_tok_posts4"]]) as unknown as Map<string, string>;
  g.__motionHeaders = new Map([["user-agent", "test-agent"]]);
  g.__motionSupabase = { user: null };
  try {
    const { status } = await postJson(() =>
      postsRoute(
        new Request("http://localhost:3000/api/posts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: "new post is fine", mediaUrls: ["https://ok.example/fresh.png"] }),
        })
      ) as Promise<Response>
    );
    assert.equal(status, 201);
    const db = (await readDB()) as unknown as {
      posts: Array<{ id: string; mediaUrls: string[] }>;
    };
    const legacy = db.posts.find((p) => p.id === "p_legacy");
    assert.ok(legacy, "legacy record is not removed or rewritten");
    assert.deepEqual(legacy.mediaUrls, ["javascript:alert(1)"], "legacy record stays untouched");
    assert.equal(db.posts.length, 2, "new post persisted alongside it");
  } finally {
    g.__motionCookieJar = null;
    g.__motionSupabase = null;
  }
});

test("community create rejects unsafe avatar URLs and stores validated ones", async () => {
  const { resetDB, readDB } = await import("./stubs/db-stub.mjs");
  resetDB(seedDB([baseUser("u_grp1", "founder1")], "s_tok_grp1", "u_grp1"));
  g.__motionCookieJar = makeJar([["motion_session", "s_tok_grp1"]]) as unknown as Map<string, string>;
  g.__motionHeaders = new Map([["user-agent", "test-agent"]]);
  g.__motionSupabase = { user: null };
  try {
    const rejected = await postJson(() =>
      groupsRoute(
        new Request("http://localhost:3000/api/groups", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "create", name: "Robotics Club", avatarUrl: "javascript:alert(1)" }),
        })
      ) as Promise<Response>
    );
    assert.equal(rejected.status, 422);

    const accepted = await postJson(() =>
      groupsRoute(
        new Request("http://localhost:3000/api/groups", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "create", name: "Robotics Club", avatarUrl: "https://ok.example/club.png" }),
        })
      ) as Promise<Response>
    );
    assert.equal(accepted.status, 201);
    const db = (await readDB()) as unknown as { groups: Array<{ avatarUrl: string | null }> };
    assert.equal(db.groups[0].avatarUrl, "https://ok.example/club.png");
  } finally {
    g.__motionCookieJar = null;
    g.__motionSupabase = null;
  }
});

test("group chat create rejects unsafe avatar URLs and stores validated ones", async () => {
  const { resetDB, readDB } = await import("./stubs/db-stub.mjs");
  resetDB(seedDB([baseUser("u_gc1", "starter1"), baseUser("u_gc2", "friend2")], "s_tok_gc1", "u_gc1"));
  g.__motionCookieJar = makeJar([["motion_session", "s_tok_gc1"]]) as unknown as Map<string, string>;
  g.__motionHeaders = new Map([["user-agent", "test-agent"]]);
  g.__motionSupabase = { user: null };
  try {
    const rejected = await postJson(() =>
      groupChatsRoute(
        new Request("http://localhost:3000/api/group-chats", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "create", name: "Crew", avatar_url: "javascript:alert(1)" }),
        })
      ) as Promise<Response>
    );
    assert.equal(rejected.status, 422);

    const accepted = await postJson(() =>
      groupChatsRoute(
        new Request("http://localhost:3000/api/group-chats", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "create", name: "Crew", avatar_url: "https://ok.example/crew.png", member_ids: ["u_gc2"] }),
        })
      ) as Promise<Response>
    );
    assert.equal(accepted.status, 200);
    const db = (await readDB()) as unknown as { dmGroups: Array<{ avatarUrl: string | null }> };
    assert.equal(db.dmGroups[0].avatarUrl, "https://ok.example/crew.png");
  } finally {
    g.__motionCookieJar = null;
    g.__motionSupabase = null;
  }
});

test("community post rejects unsafe gif URLs and event links, keeps safe ones", async () => {
  const { resetDB, readDB } = await import("./stubs/db-stub.mjs");
  const group = {
    id: "g_evt",
    name: "Fest Club",
    tag: "General",
    tags: ["General"],
    description: "x",
    school: "Northgate",
    createdAt: now,
    members: [{ userId: "u_cp1", role: "admin", joinedAt: now }],
    visibility: "public",
    avatarUrl: null,
    joinRequests: [],
    posts: [],
  };
  resetDB(seedDB([baseUser("u_cp1", "member1")], "s_tok_cp1", "u_cp1", { groups: [group] }));
  g.__motionCookieJar = makeJar([["motion_session", "s_tok_cp1"]]) as unknown as Map<string, string>;
  g.__motionHeaders = new Map([["user-agent", "test-agent"]]);
  g.__motionSupabase = { user: null };
  const call = (payload: Record<string, unknown>) =>
    communityPostRoute(
      new Request("http://localhost:3000/api/groups/g_evt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
      { params: Promise.resolve({ id: "g_evt" }) }
    );
  try {
    const badGif = await postJson(() =>
      call({ action: "post", text: "gif meme", gif_url: "javascript:alert(1)" })
    );
    assert.equal(badGif.status, 422);

    const badLink = await postJson(() =>
      call({
        action: "post",
        type: "event",
        text: "spring fest",
        event_data: { title: "Spring Fest", date: "2026-05-01", location: "Quad", link: "javascript:alert(1)" },
      })
    );
    assert.equal(badLink.status, 422);

    const okEvent = await postJson(() =>
      call({
        action: "post",
        type: "event",
        text: "spring fest",
        event_data: { title: "Spring Fest", date: "2026-05-01", location: "Quad", link: "https://fest.example.edu/" },
      })
    );
    assert.equal(okEvent.status, 200);
    const db = (await readDB()) as unknown as { groups: Array<{ posts: Array<{ id: string; event: { link?: string } | null }> }> };
    const stored = db.groups[0].posts.find((p) => p.event);
    assert.ok(stored);
    assert.equal(stored.event?.link, "https://fest.example.edu/");
    assert.equal(db.groups[0].posts.length, 1, "rejected variations were not persisted");
  } finally {
    g.__motionCookieJar = null;
    g.__motionSupabase = null;
  }
});

test("settings API rejects unsafe avatar URLs before writing the profile", async () => {
  const { resetDB, readDB } = await import("./stubs/db-stub.mjs");
  resetDB(seedDB([baseUser("u_set1", "setter1")], "s_tok_set1", "u_set1"));
  g.__motionCookieJar = makeJar([["motion_session", "s_tok_set1"]]) as unknown as Map<string, string>;
  g.__motionHeaders = new Map([["user-agent", "test-agent"]]);
  g.__motionSupabase = { user: null };
  try {
    const rejected = await postJson(() =>
      settingsRoute(
        new Request("http://localhost:3000/api/settings", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ avatarUrl: "javascript:alert(1)" }),
        })
      ) as Promise<Response>
    );
    assert.equal(rejected.status, 422);
    let db = (await readDB()) as unknown as { users: Array<{ photo?: string; banner?: string }> };
    assert.ok(!db.users[0].photo, "nothing was written on rejection");

    const accepted = await postJson(() =>
      settingsRoute(
        new Request("http://localhost:3000/api/settings", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ bannerUrl: "https://ok.example/banner.png" }),
        })
      ) as Promise<Response>
    );
    assert.equal(accepted.status, 200);
    db = (await readDB()) as unknown as { users: Array<{ photo?: string; banner?: string }> };
    assert.equal(db.users[0].banner, "https://ok.example/banner.png");
  } finally {
    g.__motionCookieJar = null;
    g.__motionSupabase = null;
  }
});

/* ========================================================================== */
/* Part C â€” browser-plane mirrors (Supabase-mode direct writes)                */
/* ========================================================================== */

const { createGroup } = (await import("@/lib/dm-backends")) as {
  createGroup: (input: { name: string; description: string; avatarUrl: string | null; memberIds: string[] }) => Promise<string>;
};
const { updateOwnProfile } = (await import("@/lib/db/profiles")) as {
  updateOwnProfile: (patch: Record<string, unknown>) => Promise<unknown>;
};

test("createGroup mirror rejects unsafe avatars before any backend call", async () => {
  stubFetch(() => null);
  g.__motionSupabaseClient = {
    user: { id: "u_mirror1" },
    rpcHandlers: {
      create_group_chat_with_members: () => {
        throw new Error("RPC must not be reached for an invalid avatar URL");
      },
    },
  };
  try {
    await assert.rejects(
      createGroup({ name: "Crew", description: "", avatarUrl: "javascript:alert(1)", memberIds: [] }),
      /media link|https|URL/i
    );
    assert.equal(fetchCalls.length, 0, "no network activity happened");
  } finally {
    g.__motionSupabaseClient = null;
  }
});

test("createGroup mirror still succeeds with a safe avatar via the RPC path", async () => {
  stubFetch(() => null);
  g.__motionSupabaseClient = {
    user: { id: "u_mirror2" },
    rpcHandlers: { create_group_chat_with_members: () => "gc_created_ok" },
  };
  try {
    const id = await createGroup({
      name: "Crew",
      description: "",
      avatarUrl: "https://ok.example/crew.png",
      memberIds: [],
    });
    assert.equal(id, "gc_created_ok");
    assert.equal(fetchCalls.length, 0);
  } finally {
    g.__motionSupabaseClient = null;
  }
});

test("updateOwnProfile mirror rejects unsafe avatar and link values before any write", async () => {
  stubFetch(() => null);
  g.__motionSupabaseClient = { user: { id: "u_prof1" } };
  try {
    await assert.rejects(
      updateOwnProfile({ avatar_url: "javascript:alert(1)" }),
      /media link|https|URL/i
    );
    await assert.rejects(updateOwnProfile({ github_url: "javascript:alert(1)" }), /github|https|URL/i);
    await assert.rejects(updateOwnProfile({ banner_url: "data:text/html;base64,AAAA" }), /formats|html|https|URL/i);
    assert.equal(fetchCalls.length, 0, "no persist happened for rejected payloads");
  } finally {
    g.__motionSupabaseClient = null;
  }
});

test("updateOwnProfile mirror keeps valid values and legacy bare domains flowing", async () => {
  stubFetch((url) => (url.includes("/api/settings") ? { ok: true } : null));
  g.__motionSupabaseClient = { user: { id: "u_prof2" } };
  try {
    await updateOwnProfile({ avatar_url: "https://ok.example/me.png", github_url: "github.com/niko" });
    assert.equal(fetchCalls.length, 1, "fell through to the legacy settings mirror");
    assert.match(fetchCalls[0].url, /\/api\/settings$/);
    const sent = JSON.parse(String(fetchCalls[0].init?.body)) as { photo?: string };
    assert.equal(sent.photo, "https://ok.example/me.png", "validated value passes through unchanged");
  } finally {
    g.__motionSupabaseClient = null;
  }
});
