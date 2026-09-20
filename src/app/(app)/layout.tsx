import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/session";
import AppShell from "@/components/layout/AppShell";
import { Providers } from "@/components/providers";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const userId = await getSessionUserId();
  if (!userId) redirect("/");

  return (
    <Providers>
      <AppShell>{children}</AppShell>
    </Providers>
  );
}
