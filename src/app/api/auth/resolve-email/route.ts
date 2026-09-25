import { NextResponse } from "next/server";
import { createAdminClient, hasAdminClientConfig } from "@/lib/supabase/admin";

/**
 * Maps a public Motion username to the email Supabase Auth needs for password
 * sign-in. This stays server-only because Auth email addresses are private.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { username?: unknown };
  const username = typeof body.username === "string"
    ? body.username.trim().replace(/^@+/, "").toLowerCase()
    : "";

  if (!/^[a-z0-9_.-]{3,20}$/.test(username) || !hasAdminClientConfig()) {
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }

  try {
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("id")
      .ilike("username", username)
      .maybeSingle();
    if (!profile) return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });

    const { data, error } = await admin.auth.admin.getUserById(profile.id);
    if (error || !data.user?.email) {
      return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
    }
    return NextResponse.json({ email: data.user.email });
  } catch {
    return NextResponse.json({ error: "Unable to sign in." }, { status: 500 });
  }
}
