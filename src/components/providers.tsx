"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, X } from "lucide-react";
import { api } from "@/lib/client";
import type { PublicUser } from "@/lib/schema";
import ComposerModal from "@/components/feed/ComposerModal";
import { signOut as signOutSupabase } from "@/lib/supabase/auth";

interface SessionCtx {
  me: PublicUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  unreadCount: number;
  refreshUnread: () => Promise<void>;
  pendingRequests: number;
  refreshChats: () => Promise<void>;
  quietActive: boolean;
  updateSettings: (patch: Record<string, unknown>) => Promise<boolean>;
  /** True in dev when no session cookie exists (APIs fall back to the seeded user). */
  devFallbackSession: boolean;
}

const SessionContext = createContext<SessionCtx>({
  me: null,
  loading: true,
  refresh: async () => {},
  signOut: async () => {},
  unreadCount: 0,
  refreshUnread: async () => {},
  pendingRequests: 0,
  refreshChats: async () => {},
  quietActive: false,
  updateSettings: async () => false,
  devFallbackSession: false,
});

export const useSession = () => useContext(SessionContext);

interface Toast {
  id: number;
  text: string;
}

interface UICtx {
  toast: (text: string) => void;
  openComposer: () => void;
  openProfile: (handle: string) => void;
}

const UIContext = createContext<UICtx>({
  toast: () => {},
  openComposer: () => {},
  openProfile: () => {},
});

export const useUI = () => useContext(UIContext);

let toastSeq = 1;

export function Providers({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [devFallbackSession, setDevFallbackSession] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [composerOpen, setComposerOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ user: PublicUser | null; devFallback?: boolean }>("/api/session");
      setMe(r.user);
      setDevFallbackSession(Boolean(r.devFallback));
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshUnread = useCallback(async () => {
    try {
      const r = await api<{ unread: number }>("/api/notifications");
      setUnreadCount(r.unread);
    } catch {
      /* signed out */
    }
  }, []);

  const refreshChats = useCallback(async () => {
    try {
      const r = await api<{ threads: Array<{ status: string; requestedByMe: boolean }> }>("/api/chats");
      setPendingRequests(r.threads.filter((t) => t.status === "pending" && !t.requestedByMe).length);
    } catch {
      /* signed out */
    }
  }, []);

  useEffect(() => {
    refresh().then(() => {
      refreshUnread();
      refreshChats();
    });
  }, [refresh, refreshUnread, refreshChats]);

  const signOut = useCallback(async () => {
    try { await signOutSupabase(); } catch { /* local Motion accounts may not have a Supabase session */ }
    try { await api("/api/session", { method: "DELETE" }); } catch { /* continue with the client-side sign-out */ } finally {
      setMe(null);
      window.location.assign("/welcome");
    }
  }, []);

  const updateSettings = useCallback(
    async (patch: Record<string, unknown>) => {
      try {
        await api("/api/settings", { method: "PATCH", body: JSON.stringify(patch) });
        await refresh();
        return true;
      } catch (e) {
        setToasts((t) => [...t, { id: toastSeq++, text: e instanceof Error ? e.message : "Couldn't save setting" }]);
        return false;
      }
    },
    [refresh]
  );

  // Quiet Mode: explicit pause window or School-Hours DND (weekdays 8:00–15:00).
  const quietActive = useMemo(() => {
    if (!me) return false;
    const now = new Date();
    if (me.settings.quietUntil && new Date(me.settings.quietUntil) > now) return true;
    if (me.settings.schoolHoursDND) {
      const day = now.getDay();
      const hour = now.getHours();
      if (day >= 1 && day <= 5 && hour >= 8 && hour < 15) return true;
    }
    return false;
  }, [me]);

  // Push display settings onto <html> so the whole app reacts instantly.
  useEffect(() => {
    const s = me?.settings;
    const root = document.documentElement;
    const theme = s?.theme ?? "dark";
    root.dataset.theme =
      theme === "system" ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : theme;
    root.dataset.textSize = s?.textSize ?? "default";
    root.dataset.motion = s?.reducedMotion ? "reduced" : "full";
    root.dataset.contrast = s?.highContrast ? "high" : "normal";
  }, [me]);

  const toast = useCallback((text: string) => {
    const id = toastSeq++;
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  }, []);

  const router = useRouter();
  const openComposer = useCallback(() => setComposerOpen(true), []);
  // Full-page profiles: every avatar/handle click routes to /profile/[username].
  // Accepts handles ("zoedesigns") and user ids ("u_zoe") — both resolve.
  const openProfile = useCallback(
    (handle: string) => {
      router.push(`/profile/${encodeURIComponent(handle.replace(/^@/, ""))}`);
    },
    [router]
  );

  const sessionValue = useMemo(
    () => ({ me, loading, refresh, signOut, unreadCount, refreshUnread, pendingRequests, refreshChats, quietActive, updateSettings, devFallbackSession }),
    [me, loading, refresh, signOut, unreadCount, refreshUnread, pendingRequests, refreshChats, quietActive, updateSettings, devFallbackSession]
  );
  const uiValue = useMemo(() => ({ toast, openComposer, openProfile }), [toast, openComposer, openProfile]);

  return (
    <SessionContext.Provider value={sessionValue}>
      <UIContext.Provider value={uiValue}>
        {children}
        {composerOpen && <ComposerModal onClose={() => setComposerOpen(false)} />}
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2">
          {toasts.map((t) => (
            <div key={t.id} className="glass scale-in pointer-events-auto flex items-center gap-2 px-4 py-2.5 text-sm shadow-2xl">
              <CheckCircle2 size={16} className="text-gold" />
              {t.text}
            </div>
          ))}
        </div>
      </UIContext.Provider>
    </SessionContext.Provider>
  );
}

export function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-full border border-edge bg-card/60 p-1.5 text-mist transition hover:text-ink" aria-label="Close">
      <X size={16} />
    </button>
  );
}
