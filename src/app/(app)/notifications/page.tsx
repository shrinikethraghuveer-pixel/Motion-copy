"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, CalendarPlus, CheckCheck, Heart, MessageCircle, Repeat, UserPlus, BadgeCheck } from "lucide-react";
import { api, post, type Notification } from "@/lib/client";
import { timeAgo } from "@/lib/utils";
import { useSession, useUI } from "@/components/providers";
import { Avatar, EmptyState } from "@/components/ui/primitives";

type Filter = "all" | "mentions" | "requests" | "activity";

const TABS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" }, { id: "mentions", label: "Mentions" },
  { id: "requests", label: "Requests" }, { id: "activity", label: "Activity" },
];

const META = {
  connect: { icon: UserPlus, tone: "text-violet-600 dark:text-violet-400", message: "wants to connect with you" },
  accept: { icon: BadgeCheck, tone: "text-violet-600 dark:text-violet-400", message: "accepted your connection request" },
  like: { icon: Heart, tone: "text-rose-500", message: "liked your post" },
  comment: { icon: MessageCircle, tone: "text-sky-500", message: "mentioned you in a comment" },
  repost: { icon: Repeat, tone: "text-emerald-500", message: "reposted your motion update" },
  event: { icon: CalendarPlus, tone: "text-amber-500", message: "saved your event" },
} satisfies Record<Notification["type"], { icon: typeof Bell; tone: string; message: string }>;

function actorName(actorId: string) {
  return actorId.replace(/^u_/, "").replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function NotificationsPage() {
  const { refreshUnread } = useSession();
  const { toast, openProfile } = useUI();
  const [items, setItems] = useState<Notification[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [processingId, setProcessingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api<{ notifications: Notification[] }>("/api/notifications");
      setItems(result.notifications);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Failed to load notifications");
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const visibleItems = useMemo(() => items.filter((item) => {
    if (filter === "mentions") return item.type === "comment";
    if (filter === "requests") return item.type === "connect" || item.type === "accept";
    if (filter === "activity") return item.type === "like" || item.type === "repost" || item.type === "event";
    return true;
  }), [filter, items]);

  const markAll = async () => {
    try {
      await api("/api/notifications", { method: "PATCH" });
      await load();
      refreshUnread();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not update notifications");
    }
  };

  const respondToRequest = async (notification: Notification, action: "accept" | "remove") => {
    setProcessingId(notification.id);
    try {
      await post("/api/connections", { targetId: notification.actorId, action });
      setItems((current) => current.map((item) => item.id === notification.id ? { ...item, read: true } : item));
      refreshUnread();
      toast(action === "accept" ? "Connection accepted" : "Connection request declined");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not update connection request");
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <main className="relative mx-auto flex min-h-[calc(100vh-5rem)] max-w-4xl flex-col gap-6 bg-slate-200/70 px-4 py-6 dark:bg-zinc-950">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Notifications</h1>
        <button onClick={() => void markAll()} className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet-600 transition-colors hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300"><CheckCheck size={15} /> Mark all as read</button>
      </header>

      <nav className="flex flex-wrap gap-2" aria-label="Notification filters">
        {TABS.map((tab) => (
          <button key={tab.id} onClick={() => setFilter(tab.id)} className={filter === tab.id ? "rounded-full bg-violet-600 px-4 py-1.5 text-sm font-medium text-white shadow-md shadow-violet-600/20" : "rounded-full border border-slate-300/70 bg-white/70 px-4 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-slate-100/80 dark:border-zinc-800/80 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:bg-zinc-800/60"}>{tab.label}</button>
        ))}
      </nav>

      <section className="overflow-hidden rounded-2xl border border-white/90 bg-white/80 shadow-xl shadow-slate-300/50 backdrop-blur-xl dark:border-zinc-800/80 dark:bg-zinc-900/60 dark:shadow-none" aria-label="Notification activity">
        {visibleItems.length === 0 ? <EmptyState icon={<Bell size={28} />} title="All quiet" hint="Connection requests, likes, and comments land here." /> : visibleItems.map((notification) => {
          const meta = META[notification.type];
          const Icon = meta.icon;
          const name = actorName(notification.actorId);
          const isRequest = notification.type === "connect";
          return (
            <article key={notification.id} className="relative flex items-start gap-4 border-b border-slate-200/80 p-4 transition-colors last:border-none hover:bg-slate-100/60 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40">
              {!notification.read && <span className="absolute inset-y-0 left-0 w-1 bg-violet-500/10" aria-label="Unread" />}
              <div className={`mt-1 shrink-0 ${meta.tone}`}><Icon size={19} aria-hidden="true" /></div>
              <button onClick={() => openProfile(notification.actorId)} className="shrink-0" aria-label={`Open ${name}'s profile`}><Avatar user={{ id: notification.actorId, name }} size={40} /></button>
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-5 text-zinc-600 dark:text-zinc-400"><button onClick={() => openProfile(notification.actorId)} className="font-semibold text-zinc-900 hover:underline dark:text-zinc-100">{name}</button>{" "}{meta.message} <time className="ml-1 whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-500">{timeAgo(notification.createdAt)}</time></p>
                {(notification.type === "like" || notification.type === "comment") && <p className="mt-1 rounded-md border border-slate-200 bg-slate-100 p-2 text-xs italic text-zinc-600 dark:border-zinc-700/50 dark:bg-zinc-800/50 dark:text-zinc-400">{notification.text ? `“${notification.text}”` : "“A project update worth revisiting.”"}</p>}
                {isRequest && <div className="mt-3 flex gap-2"><button disabled={processingId === notification.id} onClick={() => void respondToRequest(notification, "accept")} className="rounded-lg bg-violet-600 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-violet-700 disabled:opacity-50">Accept</button><button disabled={processingId === notification.id} onClick={() => void respondToRequest(notification, "remove")} className="rounded-lg bg-slate-200 px-3 py-1 text-xs text-zinc-700 transition-colors hover:bg-slate-300 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700">Decline</button></div>}
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
