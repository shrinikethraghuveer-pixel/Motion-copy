import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase session cookie on every request and gates the
 * authenticated app routes (/home, /settings, /profile, …). Unauthenticated
 * users are redirected to /login (which opens the auth dialog) with a
 * `next` param so they land where they intended after signing in.
 */
const PUBLIC_PREFIXES = ["/api", "/_next", "/favicon"];

/** Legacy demo-auth cookie used by the JSON-store dashboard. */
const LEGACY_SESSION_COOKIE = "motion_session";

/** Routes that require a Supabase session (or legacy demo cookie). */
const PROTECTED_ROUTES = ["/home", "/settings", "/profile", "/explore", "/notifications", "/chat", "/my-space", "/connect", "/connections", "/onboarding", "/admin"];

export async function middleware(request: NextRequest) {
  // Local UI development should not be gated by Supabase or legacy cookies.
  // Route handlers resolve the seeded development user through getSessionUserId.
  if (process.env.NODE_ENV === "development") return NextResponse.next();

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Demo accounts authenticate through the legacy JSON-store cookie.
  const legacySession = request.cookies.get(LEGACY_SESSION_COOKIE)?.value;

  const { pathname } = request.nextUrl;
  const isPublic =
    pathname === "/" ||
    pathname === "/terms" ||
    pathname === "/privacy" ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/welcome") ||
    pathname.startsWith("/signup") ||
    PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
  const isProtected = PROTECTED_ROUTES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );

  if (!user && !legacySession && !isPublic) {
    // New / logged-out visitors land on the welcome page, not the old shell.
    const url = request.nextUrl.clone();
    url.pathname = "/welcome";
    url.search = "";
    if (isProtected) url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Run on everything except static assets and Next internals.
     * API routes are matched so their Supabase cookies get refreshed too.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
