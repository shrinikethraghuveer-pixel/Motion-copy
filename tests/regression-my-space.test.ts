/**
 * Audit 3C regression: the my-space "classmates" discovery list must honor the
 * same visibility rules as the other people-discovery surfaces (campus
 * discovery opt-out, deactivation, and blocked/muted in both directions).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

Object.assign(process.env, { NODE_ENV: "test" });

import { globals, localUser, makeJar, baseSession, type TestGlobals } from "./helpers/route-test.ts";
import { resetDB } from "./stubs/db-stub.mjs";

const { GET } = (await import("@/app/api/my-space/route")) as unknown as {
  GET: (req: Request) => Promise<Response>;
};

const SCHOOL = "Northside High";

function mySpaceRequest(): Request {
  return new Request("http://localhost:3000/api/my-space", { headers: { cookie: "" } });
}

function settings(overrides: { discoverable?: boolean; privateProfile?: boolean; blocked?: string[]; muted?: string[] }): Record<string, unknown> {
  return {
    theme: "dark",
    accentColor: null,
    lowSpecMode: false,
    reducedMotion: false,
    twoFactor: { enabled: false, method: "app" },
    passkeys: [],
    privateProfile: overrides.privateProfile ?? false,
    showSchool: true,
    showAgeTag: true,
    discoverable: overrides.discoverable ?? true,
    personalizeSuggestions: false,
    allowDMs: "everyone",
    allowMentions: "everyone",
    allowConnectRequests: "everyone",
    allowReposts: true,
    messaging: "everyone",
    blurMedia: false,
    blocked: overrides.blocked ?? [],
    muted: overrides.muted ?? [],
    notify: { likes: true, comments: true, reposts: true, dms: true, connections: true, opportunities: true, announcements: true, emailDigest: false, smsAlerts: false },
    schoolHoursDND: false,
    quietUntil: null,
    textSize: "default",
    displayFont: "space",
    highContrast: false,
    language: "en",
    timezone: "system",
    aiPostSharpening: true,
    aiSmartRanking: true,
    aiDefaultModel: "openai/gpt-oss-20b",
    emailDigest: "weekly",
  } as Record<string, unknown>;
}

function user(id: string, handle: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...localUser(id, handle, { school: SCHOOL, ...overrides }), settings: overrides.settings ?? {} };
}

function fixture(): Parameters<typeof resetDB>[0] {
  return {
    users: [
      localUser("u_me", "mspacer", { school: SCHOOL, settings: settings({ blocked: ["u_iblocked"], muted: ["u_mutedwme"] }) }),
      localUser("u_ok", "visiblepeer", { school: SCHOOL, settings: settings({}) }),
      localUser("u_priv", "privatepeer", { school: SCHOOL, settings: settings({ privateProfile: true }) }),
      localUser("u_opt", "hiddennow", { school: SCHOOL, settings: settings({ discoverable: false }) }),
      localUser("u_deact", "gonepeer", { school: SCHOOL, deactivatedAt: new Date().toISOString(), settings: settings({}) }),
      localUser("u_theyblocked", "gatedout", { school: SCHOOL, settings: settings({ blocked: ["u_me"] }) }),
      localUser("u_iblocked", "gatedin", { school: SCHOOL, settings: settings({}) }),
      localUser("u_mutedwme", "quietpeer", { school: SCHOOL, settings: settings({}) }),
      localUser("u_elsewhere", "othercampus", { school: "Other High", settings: settings({}) }),
    ].map((u) => u as unknown as Record<string, unknown>),
    posts: [],
    chats: [],
    connections: [],
    reports: [],
    groups: [],
    sessions: [baseSession("s_tok_me", "u_me")],
    loginEvents: [],
  } as unknown as Parameters<typeof resetDB>[0];
}

test("classmates list respects discovery opt-outs, blocks, mutes, and deactivation", async () => {
  const jar = makeJar([["motion_session", "s_tok_me"]]);
  (globals() as TestGlobals).__motionCookieJar = jar;
  (globals() as TestGlobals).__motionHeaders = new Map([["user-agent", "test-agent"]]);
  (globals() as TestGlobals).__motionSupabase = null;
  resetDB(fixture());
  const res = await GET(mySpaceRequest());
  assert.equal(res.status, 200);
  const body = (await res.json()) as { classmates: Array<{ handle: string }> };
  const handles = body.classmates.map((c) => c.handle);
  assert.deepEqual(handles, ["visiblepeer", "privatepeer"], `unexpected classmates list: ${handles.join(", ")}`);
});
