import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { Providers } from "@/components/providers";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase=await createClient();
  const {data:{user},error:authError}=await supabase.auth.getUser();
  if(authError||!user)redirect("/");
  const {data:profile,error:profileError}=await supabase.from("profiles").select("is_deactivated").eq("id",user.id).maybeSingle();
  if(profileError){
    redirect("/");
  }
  if(profile?.is_deactivated){
    await supabase.auth.signOut({scope:"local"});
    redirect("/");
  }

  return (
    <Providers>
      <AppShell>{children}</AppShell>
    </Providers>
  );
}
