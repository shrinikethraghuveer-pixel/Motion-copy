/**
 * Shared harness helpers for route-level regression tests. Mirrors the loader
 * stubs: a cookie-jar-shaped object, injected headers, and a plain Request
 * upgraded with `nextUrl` for handlers typed as NextRequest.
 */
export interface TestGlobals {
  __motionCookieJar?: unknown;
  __motionHeaders?: Map<string, string>;
  __motionSupabase?: { user?: { id: string } | null; error?: { message: string } | null } | null;
}

export function globals(): typeof globalThis & TestGlobals {
  return globalThis as typeof globalThis & TestGlobals;
}

/** Cookie-jar stub: `get(name)` returns `{ name, value }` like Next's cookies(). */
export function makeJar(stored: Array<[string, string]>): {
  get: (name: string) => { name: string; value: string } | undefined;
  set: (name: string, value: string) => void;
  store: Map<string, string>;
} {
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

/** Handlers typed as NextRequest only use `req.url`/`req.nextUrl` — add nextUrl. */
export function asNextRequest(req: Request): Request & { nextUrl: URL } {
  (req as Request & { nextUrl?: URL }).nextUrl = new URL(req.url);
  return req as Request & { nextUrl: URL };
}

export function localUser(id: string, handle: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  return { id, handle, name: handle, grade: "high", school: "Northside High", headline: "", skills: [], goal: "Meet peers", following: [], createdAt: now, ...extra };
}

export function baseSession(token: string, userId: string): Record<string, unknown> {
  const now = new Date().toISOString();
  return { token, userId, device: "test", createdAt: now, lastSeenAt: now };
}
