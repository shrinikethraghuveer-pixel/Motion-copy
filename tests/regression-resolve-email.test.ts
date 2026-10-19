/**
 * Audit 3A regression: /api/auth/resolve-email must never expose another
 * user's private Supabase email to an unauthenticated caller and must not
 * enable account enumeration. The legitimate username+password login flow is
 * preserved server-side (the server performs the sign-in instead of handing
 * the email to the browser).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

Object.assign(process.env, { NODE_ENV: "test" });

const supabaseEnv = { NEXT_PUBLIC_SUPABASE_URL: "https://test-3a.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key-not-a-secret" };

function installEnv(): () => void {
  const saved = { ...process.env } as Record<string, string | undefined>;
  Object.assign(process.env, supabaseEnv);
  return () => {
    for (const k of Object.keys(supabaseEnv)) delete process.env[k];
    Object.assign(process.env, saved);
  };
}

type FetchLike = typeof fetch;
const realFetch = globalThis.fetch;
let profileFound = true;

function postBody(username?: string, password?: unknown): Request {
  return new Request("http://localhost:3000/api/auth/resolve-email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(password === undefined ? { username } : { username, password }),
  });
}

const { POST: resolveEmailPOST } = (await import("@/app/api/auth/resolve-email/route")) as unknown as {
  POST: (req: Request) => Promise<Response>;
};

function stubBackendFetch(): () => void {
  const fetchStub: FetchLike = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/rest/v1/profiles")) {
      const parsed = new URL(url);
      const usernameFilter = parsed.searchParams.get("username") ?? "";
      profileFound = !usernameFilter.includes("ilike.unknown");
      return new Response(JSON.stringify(profileFound ? [{ id: "00000000-0000-4000-8000-000000000001" }] : []), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/auth/v1/admin/users/")) {
      return new Response(JSON.stringify({ id: "00000000-0000-4000-8000-000000000001", email: "redacted-1@accounts.invalid", aud: "authenticated", role: "authenticated" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: "unexpected test fetch " + url }), { status: 500 });
  }) as FetchLike;
  globalThis.fetch = fetchStub;
  return () => {
    globalThis.fetch = realFetch;
  };
}

test("known username + wrong password â†’ generic 401, no email leaked", async () => {
  const restoreEnv = installEnv();
  const restoreFetch = stubBackendFetch();
  try {
    (globalThis as { __motionSupabase?: unknown }).__motionSupabase = null;
    const res = await resolveEmailPOST(postBody("knownuser", "wrong-password"));
    assert.equal(res.status, 401);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.email, undefined, "the private email must never appear in the response");
    assert.equal(JSON.stringify(body).includes("@"), false, "no @-address is disclosed");
  } finally {
    restoreFetch();
    restoreEnv();
  }
});

test("unknown username and wrong password return the IDENTICAL denial (no enumeration)", async () => {
  const restoreEnv = installEnv();
  const restoreFetch = stubBackendFetch();
  try {
    (globalThis as { __motionSupabase?: unknown }).__motionSupabase = null;
    const known = await resolveEmailPOST(postBody("knownuser", "wrong-password"));
    const unknown = await resolveEmailPOST(postBody("unknownuser", "wrong-password"));
    assert.equal(unknown.status, known.status, "same status for known and unknown usernames");
    const knownBody = await known.text();
    const unknownBody = await unknown.text();
    assert.equal(unknownBody, knownBody, "identical response bodies mean no account-existence oracle");
  } finally {
    restoreFetch();
    restoreEnv();
  }
});

test("valid username + password logs in server-side WITHOUT returning the email", async () => {
  const restoreEnv = installEnv();
  const restoreFetch = stubBackendFetch();
  try {
    (globalThis as { __motionSupabase?: unknown }).__motionSupabase = {
      signInWithPassword: ({ email, password }: { email?: string; password?: string }) => {
        const ok = email === "redacted-1@accounts.invalid" && password === "correct-password";
        return ok
          ? { data: { user: { id: "00000000-0000-4000-8000-000000000001" } }, error: null }
          : { data: { user: null }, error: { message: "Invalid login credentials." } };
      },
    };
    const res = await resolveEmailPOST(postBody("knownuser", "correct-password"));
    assert.equal(res.status, 200, "the server-side sign-in succeeds and sets session cookies");
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.email, undefined, "response must not contain the resolved email");
    assert.equal(JSON.stringify(body).includes("accounts.invalid"), false, "no identity data in the body");
  } finally {
    restoreFetch();
    restoreEnv();
    (globalThis as { __motionSupabase?: unknown }).__motionSupabase = undefined;
  }
});

test("admin client unconfigured â†’ generic 401, not a configuration leak", async () => {
  const restoreEnv = installEnv();
  try {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await resolveEmailPOST(postBody("knownuser", "correct-password"));
    assert.equal(res.status, 401);
  } finally {
    restoreEnv();
  }
});

test("malformed username â†’ generic 401 before any backend call", async () => {
  const restoreEnv = installEnv();
  const restoreFetch = stubBackendFetch();
  try {
    (globalThis as { __motionSupabase?: unknown }).__motionSupabase = null;
    const res = await resolveEmailPOST(postBody("A$B"));
    assert.equal(res.status, 401);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.email, undefined);
  } finally {
    restoreFetch();
    restoreEnv();
  }
});

test("per-username rate limit stops email hammering even when the response is safe", async () => {
  const restoreEnv = installEnv();
  const restoreFetch = stubBackendFetch();
  try {
    (globalThis as { __motionSupabase?: unknown }).__motionSupabase = null;
    const target = "ratelimited-user";
    let sawThrottle = false;
    for (let i = 0; i < 6; i++) {
      const res = await resolveEmailPOST(postBody(target, "wrong-password"));
      if (res.status === 429) { sawThrottle = true; break; }
    }
    assert.equal(sawThrottle, true, "the per-username bucket throttle kicks in at 3 attempts");
  } finally {
    restoreFetch();
    restoreEnv();
  }
});
