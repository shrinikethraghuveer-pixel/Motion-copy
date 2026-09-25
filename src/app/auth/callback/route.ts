import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readDB, serialize, writeDB } from "@/lib/db";
import { newId, setSession } from "@/lib/session";

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
      const authUser = data.user;
      if (!authUser) return NextResponse.redirect(`${origin}/login?error=auth`);
      const { data: profile } = await supabase
        .from("profiles")
        .select("username, full_name, display_name, avatar_url, bio, age, interests, goal, onboarding_completed")
        .eq("id", authUser.id)
        .maybeSingle();

      // OAuth sessions also need a Motion session because the app's API and
      // community data use the local user store.
      const db = await readDB();
      const email = authUser.email?.trim().toLowerCase();
      let appUser = email ? db.users.find((user) => user.email?.toLowerCase() === email) : undefined;
      if (appUser && profile?.username && appUser.handle !== profile.username) {
        appUser.handle = profile.username;
      }
      if (appUser && profile?.onboarding_completed && !appUser.onboardedAt) {
        appUser.onboardedAt = new Date().toISOString();
      }
      if (appUser && (appUser.handle === profile?.username || profile?.onboarding_completed)) {
        await serialize(() => writeDB(db));
      }
      if (!appUser) {
        const proposedHandle = String(profile?.username ?? authUser.user_metadata?.username ?? email?.split("@")[0] ?? "builder")
          .toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, 20) || "builder";
        let handle = proposedHandle;
        while (db.users.some((user) => user.handle.toLowerCase() === handle)) {
          const suffix = Math.random().toString(36).slice(2, 6);
          handle = `${proposedHandle.slice(0, 15)}_${suffix}`;
        }
        const interests = Array.isArray(profile?.interests) ? profile.interests.filter((item: unknown): item is string => typeof item === "string") : [];
        appUser = {
          id: newId("u"), handle,
          name: String(profile?.full_name ?? profile?.display_name ?? authUser.user_metadata?.full_name ?? handle).slice(0, 40),
          grade: "high", age: typeof profile?.age === "number" ? profile.age : 16,
          school: "Independent", headline: "Student building in public", skills: interests,
          goal: "Find collaborators", goals: ["Find collaborators"], following: [], createdAt: new Date().toISOString(),
          email, photo: typeof profile?.avatar_url === "string" ? profile.avatar_url : undefined,
          bio: typeof profile?.bio === "string" ? profile.bio : undefined,
          onboardedAt: profile?.onboarding_completed ? new Date().toISOString() : null,
        };
        db.users.push(appUser);
        await serialize(() => writeDB(db));
      }
      await setSession(appUser.id);
      let target = next && next.startsWith("/") ? next : null;

      if (!target) {
        // Route users without completed onboarding to the questionnaire.
        target = appUser.onboardedAt ? "/home" : "/onboarding";
      }
      return NextResponse.redirect(`${origin}${target}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
