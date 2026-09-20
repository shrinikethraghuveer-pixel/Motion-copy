"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, CalendarPlus, CheckCheck, Heart, MessageCircle, Repeat2, UserPlus, BadgeCheck } from "lucide-react";
import { api, type Notification } from "@/lib/client";
import { timeAgo } from "@/lib/utils";
import { useSession, useUI } from "@/components/providers";
import { Avatar, EmptyState } from "@/components/ui/primitives";

const ICONS: Record<string, { icon: typeof Bell; tone: string; verb: string }> = {
  connect: { icon: UserPlus, tone: "text-ice", verb: "sent you a connect request" },
  accept: { icon: BadgeCheck, tone: "text-ice", verb: "accepted — you're connected" },
  like: { icon: Heart, tone: "text-coral", verb: "liked your post" },
  comment: { icon: MessageCircle, tone: "text-ice", verb: "commented:" },
  repost: { icon: Repeat2, tone: "text-ice", verb: "reposted your post" },
  event: { icon: CalendarPlus, tone: "text-gold", verb: "saved your event" },
};

export default function NotificationsPage() {
  const { refreshUnread } = useSession();
  const { toast, openProfile } = useUI();
  const [items, setItems] = useState<Notification[]>([]);

  const load = useCallback(async () => {
    try {
      const r = await api<{ notifications: Notification[] }>("/api/notifications");
      setItems(r.notifications);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to load");
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const markAll = async () => {
    await api("/api/notifications", { method: "PATCH" });
    await load();
    refreshUnread();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">Notifications</h1>
        <button onClick={markAll} className="glass-pill flex items-center gap-1.5 px-4 py-1.5 text-sm text-mist hover:text-ink">
          <CheckCheck size={15} /> Mark all read
        </button>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={<Bell size={28} />} title="All quiet" hint="Connection requests, likes and comments land here." />
      ) : (
        <div className="space-y-2.5">
          {items.map((n) => {
            const meta = ICONS[n.type];
            const Icon = meta.icon;
            return (
              <div key={n.id} className={`glass flex items-center gap-3 p-4 ${n.read ? "opacity-70" : "border-gold/25"}`}>
                {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-gold" />}
                <button onClick={() => openProfile(`u_${n.actorId}`)} className="shrink-0">
                  <Avatar user={{ id: n.actorId, name: n.actorId }} size={36} />
                </button>
                <div className="min-w-0 flex-1 text-sm">
                  <span className="font-semibold">{n.actorId.replace("u_", "")}</span>{" "}
                  <span className="text-mist">{meta.verb}</span>{" "}
                  {n.text && <span className="text-ink/85">"{n.text}"</span>}
                  <span className="ml-2 text-xs text-mist">{timeAgo(n.createdAt)}</span>
                </div>
                <Icon size={16} className={`${meta.tone} shrink-0`} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
