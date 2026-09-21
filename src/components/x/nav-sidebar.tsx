"use client";

import { useEffect, useState } from "react";
import {
  Bell,
  Compass,
  Feather,
  Home,
  LogOut,
  Mail,
  Settings,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/shadcn/button";
import { getCurrentUserSession, signOut, type SessionUser } from "@/lib/supabase/auth";
import { cn } from "@/lib/utils";

const NAV = [
  { icon: Home, label: "Home", active: true },
  { icon: Compass, label: "Explore" },
  { icon: Bell, label: "Notifications" },
  { icon: Mail, label: "Messages" },
  { icon: User, label: "Profile" },
  { icon: Settings, label: "Settings" },
];

function GradientLogo({ size = 34 }: { size?: number }) {
  return (
    <div
      className="grid place-items-center rounded-2xl bg-gradient-to-br from-violet-600 via-indigo-500 to-cyan-500 shadow-glow-violet"
      style={{ width: size, height: size }}
    >
      <span className="font-display text-lg font-black text-white">M</span>
    </div>
  );
}

export function NavSidebar() {
  const [session, setSession] = useState<SessionUser | null>(null);

  useEffect(() => {
    void getCurrentUserSession().then(setSession).catch(() => {});
  }, []);

  const initials = session?.profile?.full_name
    ? session.profile.full_name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()
    : session?.profile?.username?.slice(0, 2).toUpperCase() ?? "YS";
  const displayName = session?.profile?.full_name || session?.profile?.username || "Your Name";
  const handle = session?.profile?.username ? `@${session.profile.username}` : "@yourhandle";

  return (
    <aside className="sticky top-0 flex h-screen flex-col gap-2 py-4 pr-2">
      <div className="mb-2 flex items-center gap-2.5 px-3">
        <GradientLogo />
        <span className="font-display hidden text-xl font-bold lg:block">
          <span className="x-gradient-text">Motion</span>
        </span>
      </div>

      <nav className="flex flex-col gap-1">
        {NAV.map(({ icon: Icon, label, active }) => (
          <button
            key={label}
            className={cn(
              "group flex items-center gap-3.5 rounded-xl px-3.5 py-2.5 text-[15px] font-medium transition-colors",
              active ? "text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            <span className="relative">
              <Icon
                size={21}
                className={active ? "text-violet-400 drop-shadow-[0_0_8px_rgba(139,92,246,0.8)]" : ""}
              />
              {active && (
                <span className="absolute inset-0 -z-10 rounded-full bg-violet-500/20 blur-md" />
              )}
            </span>
            <span className="hidden lg:block">{label}</span>
            {active && <span className="ml-auto hidden h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-glow-cyan lg:block" />}
          </button>
        ))}
      </nav>

      <Button size="lg" className="mt-3 w-full rounded-full font-display text-base font-bold">
        <Feather />
        <span className="hidden lg:block">Post</span>
      </Button>

      <div className="mt-auto">
        <div className="x-glass flex items-center gap-2.5 rounded-2xl p-2.5">
          <div className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-600 to-cyan-500 text-xs font-bold text-white">
            {initials}
          </div>
          <div className="hidden min-w-0 lg:block">
            <p className="truncate text-sm font-semibold">{displayName}</p>
            <p className="truncate text-xs text-muted-foreground">{handle}</p>
          </div>
          {session && (
            <button
              onClick={() => void signOut().then(() => window.location.reload())}
              className="ml-auto hidden rounded-lg p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground lg:block"
              aria-label="Sign out"
            >
              <LogOut size={16} />
            </button>
          )}
        </div>
        <p className="mt-3 hidden px-3 text-[11px] text-muted-foreground lg:block">
          {session ? "Signed in with Supabase" : "Mock session · sign in for the real thing"}
        </p>
      </div>
    </aside>
  );
}

export default NavSidebar;
