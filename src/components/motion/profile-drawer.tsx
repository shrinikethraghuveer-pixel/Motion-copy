"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  BookOpenCheck,
  Compass,
  LayoutGrid,
  Loader2,
  LogOut,
  Settings,
  X,
} from "lucide-react";
import { getCurrentUserSession, signOut, type SessionUser } from "@/lib/supabase/auth";
import { useToast } from "@/components/motion/toaster";
import { cn } from "@/lib/utils";

interface ProfileDrawerProps {
  open: boolean;
  onClose: () => void;
}

/** Slide-out drawer with the current session's identity and quick links. */
export function ProfileDrawer({ open, onClose }: ProfileDrawerProps) {
  const [session, setSession] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void getCurrentUserSession()
      .then(setSession)
      .finally(() => setLoading(false));
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const profile = session?.profile ?? null;
  const displayName =
    profile?.display_name || profile?.full_name || profile?.username || session?.email?.split("@")[0] || "Guest";

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      toast({ kind: "success", title: "Signed out", description: "See you at your next motion." });
      onClose();
      window.location.href = "/";
    } catch {
      toast({ kind: "error", title: "Sign-out failed", description: "Try again in a moment." });
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <>
      {/* scrim */}
      <div
        className={cn(
          "fixed inset-0 z-[60] bg-black/50 transition-opacity duration-300",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={onClose}
        aria-hidden="true"
      />
      {/* panel */}
      <aside
        className={cn(
          "fixed inset-y-0 right-0 z-[61] flex w-full max-w-xs flex-col border-l border-white/10 bg-zinc-950/70 shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] backdrop-blur-xl transition-transform duration-300 ease-out",
          open ? "translate-x-0" : "pointer-events-none translate-x-full"
        )}
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <span className="text-sm font-semibold text-zinc-100">Your profile</span>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200"
            aria-label="Close profile"
          >
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center text-zinc-500">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : session ? (
          <>
            {/* identity */}
            <div className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
              <div className="grid size-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-cyan-500 to-violet-600 text-sm font-bold text-white">
                {displayName.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-zinc-100">{displayName}</p>
                <p className="truncate text-xs text-zinc-400">
                  {profile?.username ? `@${profile.username}` : session.email}
                </p>
              </div>
            </div>

            {/* onboarding tags */}
            {(profile?.interests?.length || profile?.goal) && (
              <div className="space-y-3 border-b border-white/10 px-5 py-4">
                {profile?.interests?.length ? (
                  <div>
                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Interests</p>
                    <div className="flex flex-wrap gap-1.5">
                      {profile.interests.slice(0, 8).map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full border border-violet-500/25 bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-300"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {profile?.goal && (
                  <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                    <BookOpenCheck size={13} className="text-cyan-400" />
                    Goal: <span className="font-medium text-zinc-300">{profile.goal}</span>
                  </div>
                )}
              </div>
            )}

            {/* quick links */}
            <div className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
              {[
                { href: "/", label: "Home", icon: LayoutGrid },
                { href: "/", label: "Explore", icon: Compass },
                { href: "/", label: "Settings", icon: Settings },
              ].map(({ href, label, icon: Icon }) => (
                <Link
                  key={label}
                  href={href}
                  onClick={onClose}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-100"
                >
                  <Icon size={17} strokeWidth={1.8} />
                  {label}
                </Link>
              ))}
            </div>

            <div className="border-t border-white/10 p-3">
              <button
                onClick={() => void handleSignOut()}
                disabled={signingOut}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-rose-400 transition-colors hover:bg-rose-500/10 disabled:opacity-50"
              >
                {signingOut ? <Loader2 size={17} className="animate-spin" /> : <LogOut size={17} strokeWidth={1.8} />}
                Sign out
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm text-zinc-400">You&apos;re browsing as a guest.</p>
            <button
              onClick={onClose}
              className="h-9 rounded-full bg-gradient-to-r from-cyan-500 to-violet-600 px-5 text-sm font-semibold text-white transition hover:opacity-90"
            >
              Sign in to Motion
            </button>
          </div>
        )}
      </aside>
    </>
  );
}

export default ProfileDrawer;
