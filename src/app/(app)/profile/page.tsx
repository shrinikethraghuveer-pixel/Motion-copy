"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/components/providers";

/**
 * /profile has no content of its own — it forwards to the signed-in user's
 * dynamic profile page at /profile/[username].
 */
export default function ProfileIndexPage() {
  const router = useRouter();
  const { me, loading } = useSession();

  useEffect(() => {
    if (loading) return;
    if (me?.handle) router.replace(`/profile/${encodeURIComponent(me.handle)}`);
    else if (me) router.replace("/onboarding");
  }, [loading, me, router]);

  return (
    <div className="light:bg-slate-200/70 dark:bg-zinc-950 flex min-h-[calc(100vh-5rem)] items-center justify-center">
      <div className="light:bg-white/80 light:border-white/90 light:shadow-xl light:shadow-slate-300/50 dark:bg-zinc-900/60 dark:border-zinc-800/80 dark:shadow-none flex flex-col items-center gap-3 rounded-2xl border px-10 py-8 backdrop-blur-xl">
        <span className="light:border-slate-300 dark:border-zinc-700 light:bg-slate-100 dark:bg-zinc-800 size-10 animate-pulse rounded-full border" />
        <p className="text-sm light:text-zinc-500 dark:text-zinc-400">Opening your profile…</p>
      </div>
    </div>
  );
}
