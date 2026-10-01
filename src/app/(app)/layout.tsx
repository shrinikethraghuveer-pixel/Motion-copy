import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { Providers } from "@/components/providers";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
    // Send unauthenticated users to the welcome landing, never to "/" —
    // middleware now redirects signed-in traffic from "/" back to /home.
  if (authError || !user) redirect("/welcome");
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("is_deactivated, onboarding_completed")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) {
      // Do not infer an incomplete onboarding state from a failed profile
      // lookup. The authenticated session remains valid, and a subsequent
      // request can retry without sending a completed user to onboarding.
      return (
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      );
  }
  if (profile?.is_deactivated) {
    await supabase.auth.signOut({ scope: "local" });
    redirect("/welcome");
  }
  if (profile?.onboarding_completed !== true) redirect("/onboarding");

  return (
    <Providers>
      <AppShell>{children}</AppShell>
    </Providers>
  );
}
