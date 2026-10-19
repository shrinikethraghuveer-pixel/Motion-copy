import { test, after } from "node:test";
import assert from "node:assert/strict";

import { rateLimit } from "@/lib/rate-limit";
import type { NextRequest } from "next/server";

Object.assign(process.env, { NODE_ENV: "test" });
after(() => {
  Object.assign(process.env, { NODE_ENV: "test" });
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

function makeReq(ip: string): NextRequest {
  return new Request("http://localhost:3000/api/ai/stream", {
    method: "POST",
    headers: { "x-real-ip": ip },
  }) as unknown as NextRequest;
}

test("unconfigured production limiter fails closed", async () => {
  Object.assign(process.env, { NODE_ENV: "production", UPSTASH_REDIS_REST_URL: "", UPSTASH_REDIS_REST_TOKEN: "" });
  try {
    const result = await rateLimit(makeReq("10.1.0.1"), "failclosed-no-creds", "u_actor", 10, 60);
    assert.equal(result.allowed, false);
    assert.equal(result.retryAfter, 60);
  } finally {
    Object.assign(process.env, { NODE_ENV: "test" });
  }
});

test("unreachable production limiter backend fails closed", async () => {
  Object.assign(process.env, {
    NODE_ENV: "production",
    // Localhost closed port only: the connection is refused immediately without
    // touching any external service.
    UPSTASH_REDIS_REST_URL: "http://127.0.0.1:9/rest/v1",
    UPSTASH_REDIS_REST_TOKEN: "unused",
  });
  try {
    const result = await rateLimit(makeReq("10.1.0.2"), "failclosed-unreachable", "u_actor", 10, 60);
    assert.equal(result.allowed, false);
    assert.equal(result.retryAfter, 60);
  } finally {
    Object.assign(process.env, { NODE_ENV: "test" });
  }
});

test("development/test mode keeps the in-memory fallback permissive", async () => {
  Object.assign(process.env, { NODE_ENV: "test", UPSTASH_REDIS_REST_URL: "", UPSTASH_REDIS_REST_TOKEN: "" });
  const req = makeReq("10.1.0.3");
  const first = await rateLimit(req, "failclosed-dev-mode", "u_actor", 10, 60);
  assert.equal(first.allowed, true);
});
