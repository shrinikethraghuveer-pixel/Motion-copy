import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Root fallback: middleware normally redirects `/` before this renders.
 * If a request slips through (e.g. middleware bypassed), resolve the
 * Supabase session server-side and send the user to the right place.
 */
export default async function RootPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/home");
  redirect("/welcome");
}
