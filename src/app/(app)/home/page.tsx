import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import FeedView from "@/components/feed/FeedView";

/** A deliberately defensive home entry point: no session/profile failure escapes. */
export default async function HomePage() {
  // Legacy JSON-store session (demo accounts) — render the feed directly.
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Read-only in server components.
          }
        },
      },
    }
  );

  const { data: authData, error: authError } = await supabase.auth.getUser();
  // Keep this outside query handling: redirect() throws by design.
  if (authError || !authData?.user) redirect("/welcome");
  const user = authData.user;

  // Keep the profile lookup schema-compatible; FeedView owns the complete
  // multi-column feed, composer, post list, sidebar, and comment UI.
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, username")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <main
      className="min-h-screen bg-zinc-950 text-zinc-100"
      data-profile-loaded={Boolean(profile)}
      data-display-name={profile?.display_name ?? profile?.username ?? ""}
    >
      <FeedView />
    </main>
  );
}
