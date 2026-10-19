import { test, after } from "node:test";
import assert from "node:assert/strict";

Object.assign(process.env, {
  NODE_ENV: "test",
  GROQ_API_KEY: "test-key-regression-not-a-secret",
  GROQ_MODEL: "openai/gpt-oss-20b",
  // The test harness acts as its own trusted edge: declare the proxy header so
  // per-IP buckets mirror a correctly configured platform.
  MOTION_TRUSTED_RL_HEADER: "x-real-ip",
});
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

import { POST } from "@/app/api/ai/stream/route";
import { rateLimit } from "@/lib/rate-limit";
import { resetDB } from "./stubs/db-stub.mjs";
import type { NextRequest } from "next/server";
import type { DB } from "@/lib/schema";

interface TestGlobals {
  __motionCookieJar?: CookieJar;
  __motionHeaders?: Map<string, string>;
  __motionSupabase?: SupabaseStubState;
}

interface SupabaseStubState {
  user?: { id: string };
  error?: { message: string };
  settings?: { ai_default_model: string } | null;
}

class CookieJar {
  store = new Map<string, string>();
  get(name: string): { name: string; value: string } | undefined {
    const value = this.store.get(name);
    return value === undefined ? undefined : { name, value };
  }
  set(name: string, value: string): void {
    this.store.set(name, value);
  }
  delete(name: string): void {
    this.store.delete(name);
  }
}

const activeUser = { id: "u_streamer", handle: "streamer", name: "Streamer", deactivatedAt: null };
const validToken = "s_validsessiontoken0";

function freshState(jarCookie?: string): void {
  const now = new Date().toISOString();
  resetDB({
    users: [activeUser],
    connections: [],
    chats: [],
    dmGroups: [],
    posts: [],
    groups: [],
    notifications: [],
    sessions: [{ token: validToken, userId: activeUser.id, device: "test", createdAt: now, lastSeenAt: now }],
    loginEvents: [],
    reports: [],
  } as unknown as DB);
  const jar = new CookieJar();
  g.__motionCookieJar = jar;
  g.__motionHeaders = new Map([["user-agent", "test-agent"]]);
  if (jarCookie) jar.store.set("motion_session", jarCookie);
}

const g = globalThis as typeof globalThis & TestGlobals;

const originalFetch = globalThis.fetch;
let groqCalls = 0;
let groqAuth: string | null = null;
let groqModel: unknown = null;

const groqStub: typeof fetch = (input, init) => {
  groqCalls += 1;
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
  const headers = new Headers(init?.headers);
  groqAuth = headers.get("authorization");
  try {
    const parsed = JSON.parse(String(init?.body)) as { model?: unknown };
    groqModel = parsed.model;
  } catch {
    groqModel = null;
  }
  const chunks = [
    'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":" there"}}]}\n\n',
    "data: [DONE]\n\n",
  ];
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
  return Promise.resolve(new Response(stream, { status: 200 }));
};
globalThis.fetch = groqStub;
after(() => {
  globalThis.fetch = originalFetch;
  delete process.env.GROQ_API_KEY;
  delete process.env.GROQ_MODEL;
  delete process.env.MOTION_TRUSTED_RL_HEADER;
});

function makeReq(prompt: unknown, ip: string): NextRequest {
  return new Request("http://localhost:3000/api/ai/stream", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": ip },
    body: JSON.stringify(prompt),
  }) as unknown as NextRequest;
}

test("POST /api/ai/stream rejects unauthenticated requests before calling Groq", async () => {
  groqCalls = 0;
  freshState();
  const res = await POST(makeReq({ prompt: "hi" }, "10.0.0.1"));
  assert.equal(res.status, 401);
  const payload = (await res.json()) as { error?: string };
  assert.equal(payload.error, "Not signed in.");
  assert.equal(groqCalls, 0);
});

test("POST /api/ai/stream rate-limits authenticated users before calling Groq", async () => {
  groqCalls = 0;
  freshState(validToken);
  const req = makeReq({ prompt: "hi" }, "10.0.0.2");
  for (let i = 0; i < 10; i += 1) {
    const allowed = await rateLimit(req, "ai-stream", activeUser.id, 10, 60);
    assert.ok(allowed.allowed);
  }
  const res = await POST(req);
  assert.equal(res.status, 429);
  assert.match(res.headers.get("retry-after") ?? "", /^\d+$/);
  const payload = (await res.json()) as { error?: string };
  assert.match(payload.error ?? "", /Too many requests/i);
  assert.equal(groqCalls, 0);
});

test("POST /api/ai/stream streams a successful authenticated response", async () => {
  groqCalls = 0;
  groqAuth = null;
  groqModel = null;
  freshState(validToken);
  const res = await POST(makeReq({ prompt: "write a post" }, "10.0.0.3"));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/event-stream");
  assert.equal(res.headers.get("cache-control"), "no-cache, no-transform");
  const text = await res.text();
  assert.match(text, /data: {"token":"Hello"}/);
  assert.match(text, /data: {"token":" there"}/);
  assert.match(text, /data: \[DONE\]/);
  assert.equal(groqCalls, 1);
  assert.equal(groqAuth, "Bearer test-key-regression-not-a-secret");
  assert.equal(groqModel, "openai/gpt-oss-20b");
});

test("POST /api/ai/stream still validates the request body", async () => {
  groqCalls = 0;
  freshState(validToken);
  const res = await POST(makeReq({ prompt: "   " }, "10.0.0.4"));
  assert.equal(res.status, 400);
  assert.equal(groqCalls, 0);
});

test("POST /api/ai/stream returns 503 when Groq is unconfigured", async () => {
  groqCalls = 0;
  freshState(validToken);
  delete process.env.GROQ_API_KEY;
  try {
    const res = await POST(makeReq({ prompt: "hi" }, "10.0.0.5"));
    assert.equal(res.status, 503);
    assert.equal(groqCalls, 0);
  } finally {
    process.env.GROQ_API_KEY = "test-key-regression-not-a-secret";
  }
});

function installSupabase(state: SupabaseStubState | null): void {
  g.__motionSupabase = state ?? undefined;
  if (state) {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test-project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key-not-a-secret";
  }
}

after(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  g.__motionSupabase = undefined;
});

test("a verified Supabase-only user can use the AI endpoint", async () => {
  groqCalls = 0;
  groqAuth = null;
  groqModel = null;
  freshState();
  installSupabase({ user: { id: "sb-user-1" } });
  try {
    const res = await POST(makeReq({ prompt: "hi" }, "10.0.1.1"));
    assert.equal(res.status, 200);
    assert.match(await res.text(), /data: \[DONE\]/);
    assert.equal(groqCalls, 1);
  } finally {
    installSupabase(null);
  }
});

test("allowlisted Supabase model preference is honored for supabase-only users", async () => {
  groqCalls = 0;
  groqModel = null;
  freshState();
  installSupabase({ user: { id: "sb-user-2" }, settings: { ai_default_model: "openai/gpt-oss-120b" } });
  try {
    const res = await POST(makeReq({ prompt: "hi" }, "10.0.1.2"));
    assert.equal(res.status, 200);
    assert.equal(groqModel, "openai/gpt-oss-120b");
  } finally {
    installSupabase(null);
  }
});

test("non-allowlisted Supabase model preferences fall back to the server default", async () => {
  groqCalls = 0;
  groqModel = null;
  freshState();
  installSupabase({ user: { id: "sb-user-3" }, settings: { ai_default_model: "not-in-allowlist" } });
  try {
    const res = await POST(makeReq({ prompt: "hi" }, "10.0.1.3"));
    assert.equal(res.status, 200);
    assert.equal(groqModel, "openai/gpt-oss-20b");
  } finally {
    installSupabase(null);
  }
});

test("an invalid Supabase session without a local session receives 401 and no Groq call", async () => {
  groqCalls = 0;
  freshState();
  installSupabase({ error: { message: "Invalid session." } });
  try {
    const res = await POST(makeReq({ prompt: "hi" }, "10.0.1.4"));
    assert.equal(res.status, 401);
    const payload = (await res.json()) as { error?: string };
    assert.equal(payload.error, "Not signed in.");
    assert.equal(groqCalls, 0);
  } finally {
    installSupabase(null);
  }
});

test("neither authentication method receives 401 and no Groq call", async () => {
  groqCalls = 0;
  freshState();
  installSupabase({ user: undefined });
  try {
    const res = await POST(makeReq({ prompt: "hi" }, "10.0.1.5"));
    assert.equal(res.status, 401);
    assert.equal(groqCalls, 0);
  } finally {
    installSupabase(null);
  }
});

test("forged forwarding headers cannot rotate rate-limit buckets without a trusted signal", async () => {
  groqCalls = 0;
  freshState();
  installSupabase({ user: { id: "sb-user-5" } });
  const trustedHeader = process.env.MOTION_TRUSTED_RL_HEADER;
  delete process.env.MOTION_TRUSTED_RL_HEADER;
  delete process.env.VERCEL;
  try {
    const burn = makeReq({ prompt: "hi" }, "192.0.2.7");
    for (let i = 0; i < 10; i += 1) {
      const allowed = await rateLimit(burn, "ai-stream", "sb-user-5", 10, 60);
      assert.ok(allowed.allowed);
    }
    // A different forged IP must land in the same bucket: without a trusted
    // signal the attacker cannot reset their own limit.
    const res = await POST(makeReq({ prompt: "hi" }, "192.0.2.99"));
    assert.equal(res.status, 429);
    assert.equal(groqCalls, 0);
  } finally {
    if (trustedHeader) process.env.MOTION_TRUSTED_RL_HEADER = trustedHeader;
    installSupabase(null);
  }
});

test("supabase users are rate-limited consistently by their verified identity", async () => {
  groqCalls = 0;
  freshState();
  installSupabase({ user: { id: "sb-user-4" } });
  try {
    const req = makeReq({ prompt: "hi" }, "10.0.1.6");
    for (let i = 0; i < 10; i += 1) {
      const allowed = await rateLimit(req, "ai-stream", "sb-user-4", 10, 60);
      assert.ok(allowed.allowed);
    }
    const res = await POST(req);
    assert.equal(res.status, 429);
    assert.equal(groqCalls, 0);
  } finally {
    installSupabase(null);
  }
});
