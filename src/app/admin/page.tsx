import { redirect } from "next/navigation";
import { isAdminEmail } from "@/lib/admin";
import { getCurrentUser } from "@/lib/session";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import AdminModerationQueue from "@/components/admin/AdminModerationQueue";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  // Audit P0-3: parity with the API gate. Supabase-configured deployments
  // authorize admins ONLY from the verified Supabase identity; when Supabase
  // is not configured, operator-managed legacy admins remain supported. This
  // page is a convenience gate — the API is the security boundary.
  let allowed = false;
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    allowed = isAdminEmail(user?.email);
  } else {
    const legacyUser = await getCurrentUser();
    allowed = isAdminEmail(legacyUser?.email);
  }
  if (!allowed) redirect("/home");

  return <main className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100 sm:px-8"><div className="mx-auto max-w-5xl"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-400">Motion staff</p><h1 className="mt-2 text-3xl font-bold">Moderation queue</h1><p className="mt-2 text-sm text-zinc-400">Review community reports and take action on reported content or accounts.</p><div className="mt-8"><AdminModerationQueue /></div></div></main>;
}
