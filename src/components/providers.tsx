"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { CheckCircle2, X } from "lucide-react";
import { api } from "@/lib/client";
import type { PublicUser } from "@/lib/schema";
import ComposerModal from "@/components/feed/ComposerModal";
import ProfileDrawer from "@/components/profile/ProfileDrawer";

interface SessionCtx {
  me: PublicUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  unreadCount: number;
  refreshUnread: () => Promise<void>;
  pendingRequests: number;
  refreshChats: () => Promise<void>;
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
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [composerOpen, setComposerOpen] = useState(false);
  const [profileHandle, setProfileHandle] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { user } = await api<{ user: PublicUser | null }>("/api/session");
      setMe(user);
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
    await api("/api/session", { method: "DELETE" });
    setMe(null);
    window.location.href = "/";
  }, []);

  const toast = useCallback((text: string) => {
    const id = toastSeq++;
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  }, []);

  const openComposer = useCallback(() => setComposerOpen(true), []);
  const openProfile = useCallback((handle: string) => setProfileHandle(handle), []);

  const sessionValue = useMemo(
    () => ({ me, loading, refresh, signOut, unreadCount, refreshUnread, pendingRequests, refreshChats }),
    [me, loading, refresh, signOut, unreadCount, refreshUnread, pendingRequests, refreshChats]
  );
  const uiValue = useMemo(() => ({ toast, openComposer, openProfile }), [toast, openComposer, openProfile]);

  return (
    <SessionContext.Provider value={sessionValue}>
      <UIContext.Provider value={uiValue}>
        {children}
        {composerOpen && <ComposerModal onClose={() => setComposerOpen(false)} />}
        {profileHandle && <ProfileDrawer handle={profileHandle} onClose={() => setProfileHandle(null)} />}
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
