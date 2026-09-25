import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** Server-side onboarding guard, including local development where middleware is bypassed. */
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) redirect("/");
  } catch {
    redirect("/");
  }

  return children;
}
