/**
 * Audit 3C regression: community posts must honor the composer's per-post
 * audience. Members see every post; non-member viewers of a PUBLIC community
 * only see posts marked "Everyone" (legacy posts without an audience value
 * stay member-only by default).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

Object.assign(process.env, { NODE_ENV: "test" });

import { asNextRequest, baseSession, globals, localUser, makeJar } from "./helpers/route-test.ts";
import { resetDB, getDB as _getDB } from "./stubs/db-stub.mjs";

const getDBState = _getDB as unknown as () => {
  groups: Array<{ id: string; members: Array<{ userId: string; role: string; joinedAt: string }>; posts: unknown[] }>;
};

const { GET, POST: groupsPOST } = (await import("@/app/api/groups/[id]/route")) as unknown as {
  GET: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  POST: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
};

function getCommunity(id: string): Promise<Response> {
  const req = new Request(`http://localhost:3000/api/groups/${id}`);
  return GET(asNextRequest(req), { params: Promise.resolve({ id }) });
}

function communityPOST(body: unknown): Promise<Response> {
  const req = new Request("http://localhost:3000/api/groups/g_polls", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return groupsPOST(asNextRequest(req), { params: Promise.resolve({ id: "g_polls" }) });
}

function fixture(): Parameters<typeof resetDB>[0] {
  const now = new Date().toISOString();
  const base = (suffix: string) => ({
    id: `cp_${suffix}`,
    authorId: "u_owner",
    text: `post ${suffix}`,
    createdAt: now,
    pinned: false,
    replies: [{ id: `cr_${suffix}`, authorId: "u_owner", text: "a reply", createdAt: now }],
    mediaUrls: null,
    poll: null,
    event: null,
  });
  return {
    users: [localUser("u_owner", "commowner"), localUser("u_viewer", "outsideview")],
    posts: [],
    chats: [],
    connections: [],
    reports: [],
    groups: [
      {
        id: "g_pub",
        name: "Public Community",
        tag: "public",
        description: "",
        school: null,
        createdAt: now,
        members: [{ userId: "u_owner", role: "admin", joinedAt: now }],
        visibility: "public",
        joinRequests: [],
        posts: [
          { ...base("everyone"), audience: "Everyone" },
          { ...base("community"), audience: "Community Only" },
          { ...base("members"), audience: "Members Only" },
          { ...base("legacy") }, // no audience value
        ],
      },
      {
        id: "g_priv",
        name: "Private Community",
        tag: "private",
        description: "",
        school: null,
        createdAt: now,
        members: [{ userId: "u_owner", role: "admin", joinedAt: now }],
        visibility: "private",
        joinRequests: [],
        posts: [{ ...base("everyone"), audience: "Everyone" }],
      },
    ],
    sessions: [baseSession("s_tok_u_owner", "u_owner"), baseSession("s_tok_u_viewer", "u_viewer")],
    loginEvents: [],
  } as unknown as Parameters<typeof resetDB>[0];
}

function asMember(userId: string): void {
  const jar = makeJar([["motion_session", `s_tok_${userId}`]]);
  globals().__motionCookieJar = jar;
  globals().__motionHeaders = new Map([["user-agent", "test-agent"]]);
  (globalThis as { __motionSupabase?: unknown }).__motionSupabase = null;
}

test("member viewers see all audience tiers", async () => {
  asMember("u_owner");
  resetDB(fixture());
  const res = await getCommunity("g_pub");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { community: { posts: Array<{ text: string }> } };
  assert.equal(body.community.posts.length, 4);
});

test("non-members of public communities only see Everyone-audience posts", async () => {
  asMember("u_viewer");
  resetDB(fixture());
  const res = await getCommunity("g_pub");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { community: { posts: Array<{ text: string }>, myRole: string | null } };
  assert.equal(body.community.myRole, null);
  assert.deepEqual(
    body.community.posts.map((p) => p.text),
    ["post everyone", "post legacy"],
    "explicit Community/Members-only posts are hidden; legacy posts keep historical visibility"
  );
});

test("non-members see nothing in private communities (unchanged)", async () => {
  asMember("u_viewer");
  resetDB(fixture());
  const res = await getCommunity("g_priv");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { community: { posts: unknown[]; members: unknown[] } };
  assert.deepEqual(body.community.posts, []);
  assert.deepEqual(body.community.members, []);
});

test("community poll vote enforces expiry and duplicate votes (parity with the feed)", async () => {
  asMember("u_viewer");
  resetDB(fixture());
  const past = new Date(Date.now() - 4 * 86400000).toISOString(); // duration "3" → expired
  const now = new Date().toISOString();
  const state = getDBState();
  state.groups.push({
    id: "g_polls",
    name: "Polls",
    tag: "polls",
    description: "",
    school: null,
    createdAt: now,
    members: [{ userId: "u_viewer", role: "member", joinedAt: now }],
    visibility: "public",
    posts: [
      {
        id: "cp_expired",
        authorId: "u_owner",
        text: "expired community poll",
        createdAt: past,
        pinned: false,
        audience: "Community Only",
        replies: [],
        mediaUrls: null,
        poll: { question: "Q", duration: "3", multipleChoice: false, hideResults: false, totalVotes: 0, options: [{ id: "option_1", text: "A", votes: [] }, { id: "option_2", text: "B", votes: [] }] },
        event: null,
      },
      {
        id: "cp_open",
        authorId: "u_owner",
        text: "open poll",
        createdAt: now,
        pinned: false,
        audience: "Community Only",
        replies: [],
        mediaUrls: null,
        poll: { question: "Q", duration: "0", multipleChoice: false, hideResults: false, totalVotes: 1, options: [{ id: "option_1", text: "A", votes: ["u_viewer"] }, { id: "option_2", text: "B", votes: [] }] },
        event: null,
      },
    ],
  } as unknown as Parameters<typeof resetDB>[0]["groups"][number]);

  const expired = await communityPOST({ action: "vote", group_id: "g_polls", postId: "cp_expired", options: ["option_1"] });
  assert.equal(expired.status, 400);
  assert.equal(((await expired.json()) as { error: string }).error, "This poll has ended.");

  const dup = await communityPOST({ action: "vote", group_id: "g_polls", postId: "cp_open", options: ["option_2"] });
  assert.equal(dup.status, 400);
  assert.equal(((await dup.json()) as { error: string }).error, "You have already voted in this poll.");

  const capacityEvent: Record<string, unknown> = {
    id: "cp_event",
    authorId: "u_owner",
    text: "capacity event",
    createdAt: now,
    pinned: false,
    audience: "Community Only",
    replies: [],
    mediaUrls: null,
    poll: null,
    event: { title: "E", date: now, location: "X", kind: "event", capacity: 2, attendeeIds: ["u_owner", "u_peerless"] },
  };
  capacityEvent.audience = "Community Only";
  state.groups[2].posts.push(capacityEvent);
  const full = await communityPOST({ action: "rsvp", group_id: "g_polls", postId: "cp_event" });
  assert.equal(full.status, 400);
  assert.equal(((await full.json()) as { error: string }).error, "This event is at capacity.");
});
