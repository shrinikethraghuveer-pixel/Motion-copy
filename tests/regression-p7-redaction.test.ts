import { test, after } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Audit P7 redaction: interaction identity lists (likes/reposts/saved/poll
// votes/event attendees) and other-user private settings must never cross the
// API boundary. These tests drive the real route handlers against the stubbed
// legacy JSON store. MOCKED-STORE verification: Supabase RLS status for these
// payloads is tracked separately (migration proposal + deployment checklist).
// ---------------------------------------------------------------------------

Object.assign(process.env, {
  NODE_ENV: "test",
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
const { GET: groupGET } = (await import("@/app/api/groups/[id]/route")) as unknown as {
  GET: (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
};
const { GET: mySpaceGET } = (await import("@/app/api/my-space/route")) as unknown as {
  GET: (request: Request) => Promise<Response>;
};

const g = globals();

const VIEWER = "u_view";
const OTHER = "u_other";
const THIRD = "u_third";
const VIEW_TOKEN = "s_p7viewtoken01";
const now = "2026-05-01T12:00:00.000Z";

function seedBase(): void {
  resetDB({
    users: [
      // Viewer's own settings stay real for self; others must be masked.
      { ...localUser(VIEWER, "viewer", { settings: { blocked: ["u_swiped_left"], muted: ["u_noisy"], messaging: "no_one" } }) },
      {
        ...localUser(OTHER, "otherperson"),
        settings: { blocked: ["u_swiped_left"], muted: [THIRD], messaging: "no_one", passkeys: [{ id: "k1", label: "+","+": "secret" } as never] },
      },
      { ...localUser(THIRD, "thirdperson"), settings: {} },
    ],
    connections: [],
    chats: [],
    dmGroups: [],
    posts: [
      {
        id: "p_poll",
        authorId: OTHER,
        type: "poll",
        text: "Best hack team size?",
        media: null,
        poll: {
          question: "Best hack team size?",
          duration: "3",
          multipleChoice: false,
          hideResults: false,
          totalVotes: 2,
          options: [
            { id: "o1", text: "2", votes: [VIEWER, OTHER] },
            { id: "o2", text: "4", votes: [THIRD] },
          ],
        },
        likes: [VIEWER, THIRD],
        reposts: [THIRD],
        comments: [],
        savedBy: [VIEWER],
        event: null,
        createdAt: now,
      },
      {
        id: "p_event",
        authorId: OTHER,
        type: "opportunity",
        text: "Tour of the robotics lab",
        media: null,
        likes: [],
        reposts: [],
        comments: [],
        savedBy: [VIEWER],
        event: {
          title: "Lab tour",
          date: "2026-06-01T10:00:00.000Z",
          location: "Room 12",
          kind: "event",
          attendeeIds: [VIEWER, OTHER, THIRD],
        },
        createdAt: now,
      },
    ],
    groups: [
      {
        id: "g_code",
        name: "Code Circle",
        tag: "coding",
        description: "Coders",
        school: null,
        createdAt: now,
        visibility: "public",
        members: [{ userId: OTHER, role: "admin", joinedAt: now }],
        joinRequests: [],
        posts: [
          {
            id: "gp1",
            authorId: OTHER,
            text: "Who is in?",
            createdAt: now,
            pinned: false,
            replies: [{ id: "r1", authorId: THIRD, text: "me", createdAt: now }],
            poll: {
              question: "Meet Tuesday?",
              duration: "1",
              multipleChoice: false,
              hideResults: false,
              totalVotes: 1,
              options: [{ id: "o1", text: "Yes", votes: [VIEWER] }],
            },
            event: {
              title: "Sprint",
              date: "2026-06-02T10:00:00.000Z",
              location: "Quad",
              kind: "event",
              attendeeIds: [VIEWER],
            },
          },
        ],
      },
    ],
    notifications: [],
    sessions: [baseSession(VIEW_TOKEN, VIEWER)],
    loginEvents: [],
    reports: [],
  } as unknown as Parameters<typeof resetDB>[0]);
  g.__motionCookieJar = makeJar([["motion_session", VIEW_TOKEN]]);
  g.__motionHeaders = new Map([["user-agent", "test-agent"]]);
  g.__motionSupabase = { user: null };
}

after(() => {
  g.__motionSupabase = null;
  g.__motionCookieJar = undefined;
});

function assertNoIdentityArrays(json: unknown, label: string): void {
  const raw = JSON.stringify(json);
  assert.ok(!raw.includes('"attendeeIds"'), `${label}: attendeeIds must be redacted`);
  const pollLikePosts = raw.includes('"voteCount"');
  assert.ok(pollLikePosts || !raw.includes('"votes"'), `${label}: raw poll votes must be redacted`);
}

test("GET /api/posts returns hydrated FeedPost with counts and viewer flags only", async () => {
  seedBase();
  const res = await postsGET(asNextRequest(new Request("http://localhost:3000/api/posts")));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { posts: Array<Record<string, unknown>> };
  const pollPost = body.posts.find((p) => p.id === "p_poll");
  const eventPost = body.posts.find((p) => p.id === "p_event");
  assert.ok(pollPost && eventPost, "both posts stay visible");
  assertNoIdentityArrays(body.posts, "posts feed");
  assert.equal(pollPost.likesCount, 2);
  assert.equal(pollPost.repostsCount, 1);
  assert.equal(pollPost.likedByMe, true);
  assert.equal(pollPost.repostedByMe, false);
  assert.equal(pollPost.savedByMe, true);
  assert.ok(!("likes" in pollPost) && !("reposts" in pollPost) && !("savedBy" in pollPost));
  const poll = pollPost.poll as { hasVoted: boolean; options: Array<Record<string, unknown>> };
  assert.equal(poll.hasVoted, true);
  assert.ok(!("votes" in poll.options[0]));
  assert.equal(poll.options[0].voteCount, 2);
  assert.equal(poll.options[0].myVote, true);
  assert.equal(poll.options[1].voteCount, 1);
  assert.equal(poll.options[1].myVote, false);
  const event = eventPost.event as { attendeeCount: number; rsvpdByMe: boolean };
  assert.equal(event.attendeeCount, 3);
  assert.equal(event.rsvpdByMe, true);
  assert.ok(!("attendeeIds" in event));
  // Author identity stays (needed for the UI) but private settings are masked
  // (audit N1 core): another user's block/mute/passkey data never leaks.
  const author = pollPost.author as { settings: Record<string, unknown>; email?: string; passwordHash?: string };
  assert.deepEqual(author.settings.blocked, []);
  assert.deepEqual(author.settings.muted, []);
  assert.deepEqual(author.settings.passkeys, []);
  assert.equal(author.passwordHash, undefined);
  assert.equal(author.email, undefined);
});

test("GET /api/users/[handle] masks private settings of the profile viewed", async () => {
  seedBase();
  const res = await userGET(
    asNextRequest(new Request("http://localhost:3000/api/users/otherperson")),
    { params: Promise.resolve({ handle: "otherperson" }) }
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    user: { settings: Record<string, unknown>; passwordHash?: string; isSelf: boolean };
    posts: Array<Record<string, unknown>>;
    highlights: Array<Record<string, unknown>>;
  };
  assert.equal(body.user.isSelf, false);
  assert.deepEqual(body.user.settings.blocked, []);
  assert.deepEqual(body.user.settings.muted, []);
  assert.deepEqual(body.user.settings.passkeys, []);
  assert.equal(body.user.passwordHash, undefined);
  assertNoIdentityArrays(body.posts, "profile posts");
  const eventPost = body.posts.find((p) => p.id === "p_event");
  const event = eventPost?.event as { attendeeCount: number; rsvpdByMe?: boolean };
  assert.equal(event.attendeeCount, 3);
});

test("GET /api/users/[handle] keeps REAL settings for the viewer's own profile", async () => {
  seedBase();
  const res = await userGET(
    asNextRequest(new Request("http://localhost:3000/api/users/viewer")),
    { params: Promise.resolve({ handle: "viewer" }) }
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user: { settings: Record<string, unknown>; isSelf: boolean } };
  assert.equal(body.user.isSelf, true);
  assert.deepEqual(body.user.settings.blocked, ["u_swiped_left"]);
  assert.equal(body.user.settings.messaging, "no_one");
});

test("GET /api/groups/[id] redacts poll votes and attendee lists in community posts", async () => {
  seedBase();
  const res = await groupGET(
    asNextRequest(new Request("http://localhost:3000/api/groups/g_code")),
    { params: Promise.resolve({ id: "g_code" }) }
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { community: { posts: Array<Record<string, unknown>> } };
  assertNoIdentityArrays(body.community.posts, "community posts");
  const post = body.community.posts[0];
  const poll = post.poll as { hasVoted: boolean; options: Array<Record<string, unknown>> };
  assert.equal(poll.hasVoted, true);
  assert.equal(poll.options[0].voteCount, 1);
  assert.equal(poll.options[0].myVote, true);
  assert.ok(!("votes" in poll.options[0]));
  const event = post.event as { attendeeCount: number; rsvpdByMe: boolean };
  assert.equal(event.attendeeCount, 1);
  assert.equal(event.rsvpdByMe, true);
  // Replies keep author identity (needed for rendering) without raw ids-only lists.
  const reply = (post.replies as Array<Record<string, unknown>>)[0];
  assert.equal((reply.author as Record<string, unknown>).isSelf, false);
});

test("GET /api/my-space returns events as attendeeCount + self flag", async () => {
  seedBase();
  const res = await mySpaceGET(asNextRequest(new Request("http://localhost:3000/api/my-space")));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { events: Array<Record<string, unknown>> };
  assertNoIdentityArrays(body.events, "my-space events");
  const tour = body.events.find((event) => event.postId === "p_event");
  assert.ok(tour);
  assert.equal(tour.attendeeCount, 3);
  assert.equal(tour.rsvpdByMe, true);
  assert.ok(!("attendeeIds" in tour));
});
