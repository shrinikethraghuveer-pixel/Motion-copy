import { NextResponse } from "next/server";
import { DEFAULT_SETTINGS, type UserSettings } from "@/lib/schema";
import { getSupabaseAuth } from "@/lib/supabase/server-auth";

/** Group A identity payload. This deliberately does not use /api/session. */
export async function GET(request: Request) {
  const auth = await getSupabaseAuth(request);
  if (!auth) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const [{ data: profile, error: profileError }, { data: saved, error: settingsError }] = await Promise.all([
    auth.supabase.from("profiles").select("id,username,full_name,display_name,avatar_url,bio,age,goal,school,headline,created_at,is_deactivated").eq("id", auth.user.id).maybeSingle(),
    auth.supabase.from("user_settings").select("*").eq("user_id", auth.user.id).maybeSingle(),
  ]);
  if (profileError || !profile) return NextResponse.json({ error: "Your Motion profile is unavailable." }, { status: 409 });
  if (settingsError) return NextResponse.json({ error: settingsError.message }, { status: 502 });

  const settings: UserSettings = {
    ...DEFAULT_SETTINGS,
    ...(saved ? {
      privateProfile: saved.is_private,
      discoverable: saved.campus_discovery,
      allowDMs: saved.dm_audience === "none" ? "no_one" : saved.dm_audience,
      allowMentions: saved.tagging_audience === "off" ? "no_one" : saved.tagging_audience,
      theme: saved.theme_mode ?? saved.theme,
      accentColor: saved.accent_color,
      lowSpecMode: saved.low_spec_mode,
      reducedMotion: saved.low_spec_mode,
      aiPostSharpening: saved.ai_post_sharpening,
      aiSmartRanking: saved.ai_smart_ranking,
      aiDefaultModel: saved.ai_default_model,
      emailDigest: saved.email_digest,
      twoFactor: { ...DEFAULT_SETTINGS.twoFactor, enabled: saved.two_factor_enabled },
      notify: {
        ...DEFAULT_SETTINGS.notify,
        connections: saved.notify_connections,
        opportunities: saved.notify_events,
        announcements: saved.notify_polls,
        likes: saved.notify_social,
        comments: saved.notify_social,
        emailDigest: saved.email_digest !== "off",
      },
    } : {}),
  };

  return NextResponse.json({
    user: {
      id: profile.id,
      handle: profile.username,
      name: profile.display_name ?? profile.full_name ?? profile.username,
      grade: "high",
      school: profile.school ?? "",
      headline: profile.headline ?? "",
      skills: [],
      goal: profile.goal ?? "Find collaborators",
      goals: profile.goal ? [profile.goal] : ["Find collaborators"],
      following: [],
      createdAt: profile.created_at,
      age: profile.age ?? undefined,
      photo: profile.avatar_url,
      settings,
      deactivatedAt: profile.is_deactivated ? new Date().toISOString() : null,
    },
  });
}
