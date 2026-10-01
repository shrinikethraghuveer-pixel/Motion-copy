import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** Server-side onboarding guard, including local development where middleware is bypassed. */
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  let userId: string | null = null;
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      redirect("/");
    }
    userId = user.id;
  } catch {
    redirect("/");
  }

  const supabase = await createClient();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("onboarding_completed")
    .eq("id", userId)
    .maybeSingle();

  // A missing row belongs to an account that still needs onboarding; the
  // completion endpoint will upsert it. A lookup failure is deliberately not
  // interpreted as incomplete, so it cannot send a completed user backwards.
  if (!profileError && profile?.onboarding_completed === true) redirect("/home");

  return children;
}
