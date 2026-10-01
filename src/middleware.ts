import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase session cookie on every request and gates the
 * authenticated app routes (/home, /settings, /profile, …). Unauthenticated
 * users are redirected to /login (which opens the auth dialog) with a
 * `next` param so they land where they intended after signing in.
 */
const PUBLIC_PREFIXES = ["/api", "/_next", "/favicon"];

/** Routes that require a Supabase session. */
const PROTECTED_ROUTES = ["/home", "/settings", "/profile", "/explore", "/notifications", "/chat", "/my-space", "/connect", "/connections", "/onboarding", "/admin"];

export async function middleware(request: NextRequest) {
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

  const { pathname } = request.nextUrl;
  const isPublic =
    pathname === "/terms" ||
    pathname === "/privacy" ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/welcome") ||
    pathname.startsWith("/signup") ||
    PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
  const isProtected = PROTECTED_ROUTES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );

  // Root: signed-in users go to the feed, everyone else to the welcome
  // landing. `/welcome` stays public so this can never loop.
  if (pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = user ? "/home" : "/welcome";
    return NextResponse.redirect(url);
  }

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/welcome";
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
