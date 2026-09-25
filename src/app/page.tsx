import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

/**
 * Send signed-in users to the feed and keep the welcome experience for visitors.
 */
export default async function RootPage() {
  // Motion's app session covers password logins; Supabase's auth cookie covers
  // OAuth users before/without a Motion session cookie being present.
  const sessionUserId = await getSessionUserId();
  if (sessionUserId) redirect("/home");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  redirect(user ? "/home" : "/welcome");
}
