import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import WelcomePage from "./(auth)/welcome/page";

/**
 * Send signed-in users to the feed and keep the welcome experience for visitors.
 */
export default async function RootPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/home");
  return <WelcomePage />;
}
