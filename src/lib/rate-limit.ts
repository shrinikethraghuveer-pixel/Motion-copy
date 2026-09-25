import type { NextRequest } from "next/server";

type WindowEntry = { count: number; resetAt: number };
type RateLimitState = typeof globalThis & { __motionRateLimits?: Map<string, WindowEntry> };

const localState = globalThis as RateLimitState;
const memoryLimits = (localState.__motionRateLimits ??= new Map());
let warnedAboutRedis = false;

function clientAddress(request: NextRequest): string {
  // Trusted deployment proxies overwrite x-real-ip; forwarded-for is the fallback.
  return request.headers.get("x-real-ip")
    || request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim()
    || "unknown";
}

async function checkRedis(key: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean; retryAfter: number }> {
  const baseUrl = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!baseUrl || !token) throw new Error("Upstash Redis is not configured.");

  const script = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; local ttl=redis.call('TTL',KEYS[1]); return {n,ttl}";
  const response = await fetch(baseUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(["EVAL", script, "1", key, String(windowSeconds)]),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Rate-limit store returned ${response.status}.`);
  const payload = await response.json() as { result?: [number, number]; error?: string };
  if (payload.error || !Array.isArray(payload.result)) throw new Error(payload.error || "Invalid rate-limit response.");
  const [count, ttl] = payload.result;
  return { allowed: count <= limit, retryAfter: Math.max(1, ttl) };
}

/** Uses atomic Upstash Redis counters in production; memory fallback is for local development only. */
export async function rateLimit(request: NextRequest, scope: string, actorId: string, limit: number, windowSeconds: number) {
  const key = `motion:ratelimit:${scope}:${actorId}:${clientAddress(request)}`;
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    try {
      return await checkRedis(key, limit, windowSeconds);
    } catch (error) {
      console.error("[rate-limit] Redis check failed:", error instanceof Error ? error.message : error);
      // Fail closed when a configured production limiter is unavailable.
      if (process.env.NODE_ENV === "production") return { allowed: false, retryAfter: windowSeconds };
    }
  } else if (process.env.NODE_ENV === "production") {
    if (!warnedAboutRedis) {
      console.error("[rate-limit] Configure UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN for production rate limiting.");
      warnedAboutRedis = true;
    }
    return { allowed: false, retryAfter: windowSeconds };
  }

  const now = Date.now();
  const current = memoryLimits.get(key);
  if (!current || current.resetAt <= now) {
    memoryLimits.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true, retryAfter: windowSeconds };
  }
  current.count += 1;
  return { allowed: current.count <= limit, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
}

export function rateLimitResponse(retryAfter: number) {
  return Response.json({ error: "Too many requests. Please wait before trying again." }, {
    status: 429,
    headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" },
  });
}
