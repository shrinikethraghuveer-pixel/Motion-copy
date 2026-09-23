"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, MessageCircle, UserPlus, X } from "lucide-react";
import { api, post, type ProfilePayload } from "@/lib/client";
import { useSession, useUI } from "@/components/providers";
import { Avatar, Chip } from "@/components/ui/primitives";

export function ConnectMessageButtons({
  user,
  onChange,
  size = "md",
}: {
  user: { handle: string; connectionState: string; isSelf: boolean };
  onChange?: () => void;
  size?: "md" | "sm";
}) {
  const { toast } = useUI();
  const { refreshChats } = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const state = user.connectionState;

  const act = async (action: "connect" | "accept" | "remove") => {
    setBusy(true);
    try {
      const r = await post<{ state: string }>("/api/connections", { targetHandle: user.handle, action });
      if (action === "connect" && r.state === "pending_out") toast("Request sent");
      if (r.state === "connected") toast(action === "accept" ? "Connected — you're mutuals now" : "You're connected");
      if (action === "remove") toast("Connection removed");
      onChange?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const btnBase = size === "sm" ? "px-3.5 py-1.5 text-xs" : "px-5 py-2 text-sm";

  if (user.isSelf) {
    return (
      <button onClick={() => router.push(`/profile/${encodeURIComponent(user.handle)}`)} className={`glass-pill font-semibold text-mist transition hover:text-ink ${btnBase}`}>
        Edit profile
      </button>
    );
  }
  if (state === "connected") {
    return (
      <div className="flex gap-2">
        <button onClick={() => router.push("/chat")} className={`glass-pill flex items-center gap-1.5 border-ice/40 text-ice transition hover:bg-ice-soft ${btnBase}`}>
          <MessageCircle size={14} /> Message
        </button>
        <button onClick={() => act("remove")} disabled={busy} className={`glass-pill text-mist transition hover:text-coral ${btnBase}`} title="Remove connection">
          <Check size={14} />
        </button>
      </div>
    );
  }
  if (state === "pending_out") {
    return <span className={`glass-pill text-mist ${btnBase}`}>Requested</span>;
  }
  if (state === "pending_in") {
    return (
      <div className="flex gap-2">
        <button onClick={() => act("accept")} disabled={busy} className={`rounded-full bg-ice px-4 py-1.5 font-semibold text-canvas transition hover:brightness-110 ${size === "sm" ? "text-xs px-3.5" : "text-sm"}`}>
          Accept
        </button>
        <button onClick={() => act("remove")} disabled={busy} className={`glass-pill text-mist hover:text-coral ${btnBase}`}>
          <X size={14} />
        </button>
      </div>
    );
  }
  return (
    <button onClick={() => act("connect")} disabled={busy} className={`flex items-center gap-1.5 rounded-full bg-ice font-semibold text-canvas transition hover:brightness-110 disabled:opacity-50 ${btnBase}`}>
      <UserPlus size={14} /> Connect
    </button>
  );
}

export default function ProfileHeaderCard({ data, compact = false }: { data: ProfilePayload; compact?: boolean }) {
  const { user, stats } = data;
  const { openProfile } = useUI();

  return (
    <section className="glass fade-up relative overflow-hidden p-6">
      <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-gold/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 -left-10 h-52 w-52 rounded-full bg-ice/10 blur-3xl" />

      <div className="flex items-start gap-5">
        <button onClick={() => !user.isSelf && openProfile(user.handle)} className="shrink-0">
          <Avatar user={user} size={compact ? 64 : 80} ring />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display truncate text-xl font-bold">{user.name}</h1>
            <Chip tone={user.ageTag === "18+" ? "ice" : "gold"}>{user.ageTag}</Chip>
          </div>
          <p className="text-sm text-mist">@{user.handle}</p>
          {user.headline && <p className="mt-1.5 text-sm text-ink/90">{user.headline}</p>}
          <p className="mt-1 flex items-center gap-1.5 text-xs text-mist">
            {user.school}
            {user.goal ? ` · ${user.goal}` : ""}
          </p>

          <div className="mt-3 flex gap-5 text-sm">
            <span><b className="font-display">{stats.connections}</b> <span className="text-mist">Connections</span></span>
            <span><b className="font-display">{stats.posts}</b> <span className="text-mist">Posts</span></span>
            <span><b className="font-display">{stats.following}</b> <span className="text-mist">Following</span></span>
          </div>
        </div>

        <div className="shrink-0">
          <ConnectMessageButtons user={user} />
        </div>
      </div>
    </section>
  );
}
