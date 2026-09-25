import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/session";
import AppShell from "@/components/layout/AppShell";
import { Providers } from "@/components/providers";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const userId = await getSessionUserId();
  if (!userId) {
    const supabase=await createClient();
    const {data:{user}}=await supabase.auth.getUser();
    if(!user)redirect("/welcome");
    const {data:profile}=await supabase.from("profiles").select("is_deactivated").eq("id",user.id).maybeSingle();
    if(profile?.is_deactivated){await supabase.auth.signOut({scope:"local"});redirect("/welcome");}
  }

  return (
    <Providers>
      <AppShell>{children}</AppShell>
    </Providers>
  );
}
