import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Magic-link landing: Supabase redirects here with ?code=..., we exchange it
 * for a session cookie, then route brand-new users to onboarding.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const { data } = await supabase.auth.getUser();
      let target = next && next.startsWith("/") ? next : null;

      if (!target) {
        // Route users without completed onboarding to the questionnaire.
        const { data: profile } = await supabase
          .from("profiles")
          .select("onboarding_completed")
          .eq("id", data.user?.id ?? "")
          .maybeSingle();
        target = profile?.onboarding_completed ? "/home" : "/onboarding";
      }
      return NextResponse.redirect(`${origin}${target}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
