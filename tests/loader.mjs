import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stubDbUrl = pathToFileURL(path.join(root, "tests", "stubs", "db-stub.mjs")).href;

const NEXT_SERVER_URL = "virtual:next-server";
const SERVER_ONLY_URL = "virtual:server-only";

const nextServerStub = `
export class NextResponse extends globalThis.Response {
  static json(body, init) {
    const headers = new Headers(init?.headers ?? {});
    headers.set("content-type", "application/json");
    return new NextResponse(JSON.stringify(body), { status: init?.status ?? 200, headers });
  }
}
export class NextRequest extends globalThis.Request {}
`;

const SUPABASE_SERVER_URL = "virtual:supabase-server";

// Test-only stand-in for the Supabase server client. Identity comes from
// globalThis.__motionSupabase, which the test controls per case.
const supabaseServerStub = `
export async function createClient() {
  const sb = globalThis.__motionSupabase ?? null;
  const builder = (table) => {
    const rowsFor = () => (sb && sb.rows && sb.rows[table]) ?? null;
    const b = {
      select() { return b; },
      or() { return b; },
      in() { return b; },
      eq() { return b; },
      neq() { return b; },
      order() { return b; },
      limit() { return b; },
      update() { return b; },
      maybeSingle: async () => ({ data: (sb && sb.settings) ?? null, error: null }),
      then(res, rej) { return Promise.resolve({ data: rowsFor(), error: null }).then(res, rej); },
    };
    return b;
  };
  return {
    auth: {
      async getUser() {
        if (sb && sb.user) return { data: { user: sb.user }, error: null };
        return { data: { user: null }, error: (sb && sb.error) || { message: "No Supabase session." } };
      },
      async signInWithPassword(args) {
        if (sb && sb.signInWithPassword) return sb.signInWithPassword(args);
        return { data: { user: null }, error: { message: "Invalid login credentials." } };
      },
    },
    from(table) { return builder(table); },
    async rpc(fn, args) {
      const handler = sb && sb.rpcHandlers ? sb.rpcHandlers[fn] : undefined;
      if (!handler) return { data: null, error: { message: "RPC " + fn + " not configured in test stub." } };
      return { data: handler(args) ?? null, error: null };
    },
  };
}
`;

const SUPABASE_CLIENT_URL = "virtual:supabase-client";

// Test-only stand-in for the browser Supabase client. Test state comes from
// globalThis.__motionSupabaseClient (user, rpcHandlers, rpcError).
const supabaseClientStub = `
export function createClient() {
  const sb = globalThis.__motionSupabaseClient ?? null;
  return {
    auth: {
      async getUser() {
        if (sb && sb.user) return { data: { user: sb.user }, error: null };
        return { data: { user: null }, error: (sb && sb.error) || { message: "No Supabase session." } };
      },
    },
    async rpc(fn, args) {
      if (sb && sb.rpcError) return { data: null, error: sb.rpcError };
      const handler = sb && sb.rpcHandlers ? sb.rpcHandlers[fn] : undefined;
      if (!handler) return { data: null, error: { message: "RPC " + fn + " not configured in test stub." } };
      return { data: handler(args) ?? null, error: null };
    },
  };
}
`;

const NEXT_HEADERS_URL = "virtual:next-headers";

const nextHeadersStub = `
export async function cookies() {
  return globalThis.__motionCookieJar ?? { get: () => undefined, set: () => {}, delete: () => {} };
}
export async function headers() {
  return globalThis.__motionHeaders ?? new Map();
}
`;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "next/server") {
    return { url: NEXT_SERVER_URL, shortCircuit: true };
  }
  if (specifier === "next/headers") {
    return { url: NEXT_HEADERS_URL, shortCircuit: true };
  }
  // Guard module that Next's bundler normally provides — irrelevant under the
  // test loader since the code is loaded outside the server bundle.
  if (specifier === "server-only") {
    return { url: SERVER_ONLY_URL, shortCircuit: true };
  }
  if (specifier === "@/lib/supabase/server") {
    return { url: SUPABASE_SERVER_URL, shortCircuit: true };
  }
  if (specifier === "@/lib/supabase/client") {
    return { url: SUPABASE_CLIENT_URL, shortCircuit: true };
  }
  if (specifier === "@/lib/db") {
    return { url: stubDbUrl, shortCircuit: true };
  }
  if (specifier.startsWith("@/")) {
    const target = path.join(root, "src", specifier.slice(2));
    const withExt = /\.[cm]?[a-z]+$/i.test(target) ? target : `${target}.ts`;
    return { url: pathToFileURL(withExt).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url === NEXT_SERVER_URL) {
    return { format: "module", source: nextServerStub, shortCircuit: true };
  }
  if (url === SERVER_ONLY_URL) {
    return { format: "module", source: "export default {};", shortCircuit: true };
  }
  if (url === SUPABASE_SERVER_URL) {
    return { format: "module", source: supabaseServerStub, shortCircuit: true };
  }
  if (url === SUPABASE_CLIENT_URL) {
    return { format: "module", source: supabaseClientStub, shortCircuit: true };
  }
  if (url === NEXT_HEADERS_URL) {
    return { format: "module", source: nextHeadersStub, shortCircuit: true };
  }
  return nextLoad(url, context);
}
