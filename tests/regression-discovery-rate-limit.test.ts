/**
 * Audit 3F regression: scrape-prone discovery endpoints are throttled per user
 * (memory-limiter fallback in tests; Upstash-backed in production).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

Object.assign(process.env, { NODE_ENV: "test" });

import { asNextRequest, baseSession, globals, localUser, makeJar } from "./helpers/route-test.ts";
import { resetDB } from "./stubs/db-stub.mjs";

const { GET: searchGET } = (await import("@/app/api/users/search/route")) as unknown as {
  GET: (req: Request) => Promise<Response>;
};
const { GET: exploreGET } = (await import("@/app/api/explore/route")) as unknown as {
  GET: (req: Request) => Promise<Response>;
};

function fixture(): Parameters<typeof resetDB>[0] {
  return {
    users: [
      localUser("u_search", "rateseasy", { settings: {} }),
      localUser("u_explore", "explorerpeer", { settings: {} }),
      localUser("u_browse", "browserpeer", { settings: {} }),
      localUser("u_peer", "peerysearch", { settings: {} }),
    ].map((u) => u as Record<string, unknown>),
    posts: [],
    chats: [],
    connections: [],
    groups: [],
    sessions: [
      baseSession("s_tok_search", "u_search"),
      baseSession("s_tok_explore", "u_explore"),
      baseSession("s_tok_browse", "u_browse"),
      baseSession("s_tok_peer", "u_peer"),
    ],
    loginEvents: [],
  } as unknown as Parameters<typeof resetDB>[0];
}

function install(token: string): void {
  globals().__motionCookieJar = makeJar([["motion_session", token]]);
  globals().__motionHeaders = new Map([["user-agent", "test-agent"]]);
  (globals() as { __motionSupabase?: unknown }).__motionSupabase = null;
}

async function drain(handler: (req: Request) => Promise<Response>, url: string): Promise<void> {
  let saw429 = false;
  for (let i = 0; i < 70 && !saw429; i++) {
    const res = await handler(asNextRequest(new Request(url, { headers: { cookie: "" } })));
    if (res.status === 429) saw429 = true;
    else assert.ok([200, 401, 403].includes(res.status), `unexpected status ${res.status}`);
  }
  assert.equal(saw429, true, "throttling must kick in within 70 rapid requests");
}

test("GET /api/users/search is per-user throttled", async () => {
  install("s_tok_search");
  resetDB(fixture());
  await drain(searchGET, "http://localhost:3000/api/users/search?q=peer");
});

test("GET /api/explore is per-user throttled", async () => {
  install("s_tok_explore");
  resetDB(fixture());
  await drain(exploreGET, "http://localhost:3000/api/explore");
});

test("normal browsing volumes stay below the throttles", async () => {
  install("s_tok_browse");
  resetDB(fixture());
  for (let i = 0; i < 40; i++) {
    const res = await searchGET(asNextRequest(new Request(`http://localhost:3000/api/users/search?q=page${i}`, { headers: { cookie: "" } })));
    assert.equal(res.status, 200);
  }
});
