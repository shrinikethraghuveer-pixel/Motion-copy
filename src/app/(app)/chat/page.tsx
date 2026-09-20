"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Inbox, MessageCircle, Send, X } from "lucide-react";
import { api, post, type PublicUser, type ThreadSummary } from "@/lib/client";
import { timeAgo } from "@/lib/utils";
import { useSession, useUI } from "@/components/providers";
import { Avatar, EmptyState } from "@/components/ui/primitives";

type Res = { ok: boolean; status?: string };

export default function ChatPage() {
  const { refreshChats } = useSession();
  const { toast } = useUI();
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [showRequests, setShowRequests] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ threads: ThreadSummary[] }>("/api/chats");
      setThreads(r.threads);
      setActiveId((cur) => cur ?? r.threads.find((t) => t.status === "active")?.id ?? null);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to load chats");
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const active = threads.find((t) => t.id === activeId) ?? null;
  const requests = threads.filter((t) => t.status === "pending" && !t.requestedByMe);
  const list = threads.filter((t) => t.status !== "pending" || t.requestedByMe);

  const send = async () => {
    if (!draft.trim() || !active) return;
    const text = draft.trim();
    setDraft("");
    try {
      await post<Res>("/api/chats", { action: "send", chatId: active.id, text });
      await load();
      refreshChats();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to send");
    }
  };

  const respond = async (chatId: string, action: "accept" | "decline") => {
    try {
      await post<Res>("/api/chats", { action, chatId });
      if (action === "decline") toast("Request declined — sender isn't notified");
      if (action === "accept") toast("Request accepted");
      await load();
      refreshChats();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Action failed");
    }
  };

  const startChat = async (handle: string) => {
    try {
      const r = await post<{ chatId: string; status: string }>("/api/chats", { action: "send", targetHandle: handle, text: "👋" });
      await load();
      setActiveId(r.chatId);
      refreshChats();
      // If pending, remove the placeholder wave so the recipient gets a real message instead
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not start chat");
    }
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeId]);

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      <div className="space-y-3">
        <h1 className="font-display text-2xl font-bold">Chat</h1>

        <button
          onClick={() => setShowRequests((v) => !v)}
          className={`glass flex w-full items-center justify-between p-4 text-left transition ${requests.length > 0 ? "border-ice/30" : ""}`}
        >
          <span className="flex items-center gap-2.5 text-sm font-semibold">
            <Inbox size={17} className="text-ice" /> Message Requests
          </span>
          {requests.length > 0 && <span className="rounded-full bg-ice/20 px-2 py-0.5 text-xs font-bold text-ice">{requests.length}</span>}
        </button>

        {showRequests &&
          (requests.length === 0 ? (
            <p className="px-1 text-xs text-mist">No pending requests. DMs from non-connections land here.</p>
          ) : (
            requests.map((t) => (
              <div key={t.id} className="glass scale-in space-y-2.5 p-4">
                <div className="flex items-center gap-2.5">
                  <Avatar user={t.other} size={36} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{t.other.name}</p>
                    <p className="truncate text-xs text-mist">@{t.other.handle}</p>
                  </div>
                </div>
                {t.lastMessage && <p className="line-clamp-2 text-xs text-ink/75">"{t.lastMessage.text}"</p>}
                <div className="flex gap-2">
                  <button onClick={() => respond(t.id, "accept")} className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-ice py-1.5 text-xs font-bold text-canvas hover:brightness-110">
                    <Check size={13} /> Accept
                  </button>
                  <button onClick={() => respond(t.id, "decline")} className="glass-pill flex flex-1 items-center justify-center gap-1.5 py-1.5 text-xs font-semibold text-mist hover:text-coral">
                    <X size={13} /> Decline
                  </button>
                </div>
                <p className="text-[10px] text-mist/70">Declining sends no notification.</p>
              </div>
            ))
          ))}

        <div className="space-y-1.5">
          {list.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveId(t.id)}
              className={`glass flex w-full items-center gap-3 p-3 text-left transition ${activeId === t.id ? "border-ice/40" : "hover:border-ice/20"}`}
            >
              <Avatar user={t.other} size={40} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold">{t.other.name}</p>
                  {t.lastMessage && <span className="shrink-0 text-[10px] text-mist">{timeAgo(t.lastMessage.createdAt)}</span>}
                </div>
                <p className="truncate text-xs text-mist">{t.lastMessage ? t.lastMessage.text : "Say hi — conversation started"}</p>
              </div>
            </button>
          ))}
          {list.length === 0 && <p className="px-1 text-xs text-mist">No active conversations yet.</p>}
        </div>
      </div>

      <div className="glass flex min-h-[60vh] flex-col">
        {!active ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <EmptyState icon={<MessageCircle size={28} />} title="Pick a conversation" hint="Or start one from any profile's Message button." />
          </div>
        ) : active.status === "pending" ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <Avatar user={active.other} size={64} ring />
            <p className="font-display font-bold">{active.other.name}</p>
            <p className="max-w-sm text-sm text-mist">
              This is a message request. {active.requestedByMe ? "Your message is waiting for them to accept." : "Accept the request to keep chatting."}
            </p>
          </div>
        ) : (
          <>
            <header className="flex items-center gap-3 border-b border-edge p-4">
              <Avatar user={active.other} size={40} />
              <div>
                <p className="font-display font-bold">{active.other.name}</p>
                <p className="text-xs text-mist">@{active.other.handle} · {active.other.school}</p>
              </div>
            </header>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {(active.lastMessage ? [active.lastMessage] : []).map((m) => (
                <div key={m.id} className={`flex ${m.senderId === active.other.id ? "justify-start" : "justify-end"}`}>
                  <div className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${m.senderId === active.other.id ? "bg-card2" : "bg-ice/20 text-ink"}`}>
                    {m.text}
                    <div className="mt-1 text-right text-[10px] text-mist">{timeAgo(m.createdAt)}</div>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
            <div className="flex gap-2 border-t border-edge p-3">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="Message…"
                className="flex-1 rounded-full border border-edge bg-surface/70 px-4 py-2 text-sm placeholder:text-mist/60"
              />
              <button onClick={send} className="rounded-full bg-ice p-2.5 text-canvas transition hover:brightness-110" aria-label="Send">
                <Send size={16} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
