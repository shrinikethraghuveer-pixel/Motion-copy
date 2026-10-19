import { NextResponse } from "next/server";
import { createAdminClient, hasAdminClientConfig } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

/**
 * Username-only Supabase password sign-in.
 *
 * Audit 3A: the previous version resolved the account's private Auth email
 * and RETURNED it to the caller, which let any unauthenticated caller turn a
 * public Motion username into a private email address (an account-enumeration
 * and PII disclosure oracle). The endpoint now performs the password sign-in
 * entirely server-side: it resolves the email internally, calls
 * `auth.signInWithPassword` on the SSR client (which establishes the standard
 * session cookies), and answers with a generic payload. No identity data ever
 * crosses the response boundary, and every denial path returns the SAME body
 * so usernames cannot be probed.
 *
 * The body keeps the legacy shape `{ username, password }` — legacy callers
 * that supply no password are denied with the shared generic error.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { username?: unknown; password?: unknown };
  const username = typeof body.username === "string"
    ? body.username.trim().replace(/^@+/, "").toLowerCase()
    : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!/^[a-z0-9_.-]{3,20}$/.test(username) || !password || !hasAdminClientConfig()) {
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }

  // Audit N2: per-attacked-username bucket plus a shared-IP bucket (resolved
  // with trusted platform signals only, see rate-limit.ts).
  const usernameRate = await rateLimit(request as never, "resolve-email-username", username, 3, 300);
  if (!usernameRate.allowed) return rateLimitResponse(usernameRate.retryAfter);
  const ipRate = await rateLimit(request as never, "resolve-email-ip", "anon", 20, 300);
  if (!ipRate.allowed) return rateLimitResponse(ipRate.retryAfter);

  const DENIED = NextResponse.json({ error: "Invalid username or password." }, { status: 401 });

  try {
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("id")
      .ilike("username", username)
      .maybeSingle();
    if (!profile) return DENIED;

    const { data, error } = await admin.auth.admin.getUserById(profile.id);
    if (error || !data.user?.email) return DENIED;

    // Server-side sign-in: the SSR client persists the session cookies. The
    // resolved email stays inside the server process.
    const supabase = await createClient();
    const { data: session, error: signInError } = await supabase.auth.signInWithPassword({
      email: data.user.email,
      password,
    });
    if (signInError || !session.user) return DENIED;

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unable to sign in." }, { status: 500 });
  }
}
