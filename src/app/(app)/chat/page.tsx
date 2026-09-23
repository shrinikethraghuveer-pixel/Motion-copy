"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Inbox, MessageCircle, Search, Send, X } from "lucide-react";
import { api, post, type ThreadSummary } from "@/lib/client";
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
  const [searchTerm, setSearchTerm] = useState("");
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
  const visibleList = list.filter((t) => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return true;
    return [t.other.name, t.other.handle, t.lastMessage?.text ?? ""].some((value) => value.toLowerCase().includes(query));
  });

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
    <div className="min-h-[calc(100vh-5rem)] bg-slate-200/70 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-6xl flex-col px-4 py-6">
        <div className="grid h-[720px] grid-cols-12 gap-0 overflow-hidden rounded-2xl border border-white/90 bg-white/80 shadow-xl shadow-slate-300/50 backdrop-blur-md dark:border-zinc-800/80 dark:bg-zinc-900/60 dark:shadow-none">
          <aside className="col-span-12 flex flex-col border-slate-200/80 bg-slate-50/60 md:col-span-4 md:border-r dark:border-zinc-800/80 dark:bg-zinc-900/30">
            <div className="border-b border-slate-200/80 p-4 dark:border-zinc-800/80">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Messages</h1>
                <span className="text-xs text-zinc-500">{list.length}</span>
              </div>
              <label className="relative block">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search conversations"
                  aria-label="Search conversations"
                  className="w-full rounded-xl border border-slate-300 bg-slate-100 px-3 py-2 pl-9 text-xs text-zinc-900 outline-none transition focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/50 placeholder:text-zinc-500 dark:border-zinc-700/60 dark:bg-zinc-800/50 dark:text-zinc-100"
                />
              </label>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              <button
                onClick={() => setShowRequests((v) => !v)}
                className="mb-3 flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-100/90 px-3 py-2 text-left text-xs text-zinc-700 transition hover:bg-slate-200/50 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-300 dark:hover:bg-zinc-800/80"
              >
                <span className="flex items-center gap-2"><Inbox size={14} /> Message Requests</span>
                {requests.length > 0 && <span className="rounded-full bg-violet-600/20 px-2 py-0.5 text-[10px] font-semibold text-violet-300">{requests.length}</span>}
              </button>

              {showRequests && (
                <div className="mb-3 space-y-2">
                  {requests.length === 0 ? (
                    <p className="px-2 py-2 text-xs text-zinc-500">No pending requests. DMs from non-connections land here.</p>
                  ) : requests.map((t) => (
                    <div key={t.id} className="rounded-xl border border-slate-200 bg-slate-100/90 p-3 dark:border-zinc-800 dark:bg-zinc-950/40">
                      <div className="flex items-center gap-2.5">
                        <Link href={`/profile/${encodeURIComponent(t.other.handle)}`} aria-label={`Open ${t.other.name}'s profile`} className="shrink-0"><Avatar user={t.other} size={34} /></Link>
                        <Link href={`/profile/${encodeURIComponent(t.other.handle)}`} className="min-w-0 hover:text-violet-600 dark:hover:text-violet-400">
                          <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t.other.name}</p>
                          <p className="truncate text-xs text-zinc-500">@{t.other.handle}</p>
                        </Link>
                      </div>
                      {t.lastMessage && <p className="mt-2 line-clamp-2 text-xs text-zinc-400">&quot;{t.lastMessage.text}&quot;</p>}
                      <div className="mt-3 flex gap-2">
                        <button onClick={() => respond(t.id, "accept")} className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-violet-600 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500">
                          <Check size={13} /> Accept
                        </button>
                        <button onClick={() => respond(t.id, "decline")} className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800/50 py-1.5 text-xs font-semibold text-zinc-300 transition hover:bg-zinc-700/70">
                          <X size={13} /> Decline
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-1">
                {visibleList.map((t) => (
                  <div
                    key={t.id}
                    className={`flex w-full items-center gap-3 border-l-2 p-3 transition-colors ${activeId === t.id ? "border-violet-500 bg-violet-600/10 text-zinc-900 dark:text-zinc-100" : "border-transparent text-zinc-600 hover:bg-slate-200/50 dark:text-zinc-400 dark:hover:bg-zinc-800/40"}`}
                  >
                    <Link href={`/profile/${encodeURIComponent(t.other.handle)}`} onClick={(e) => e.stopPropagation()} aria-label={`Open ${t.other.name}'s profile`} className="shrink-0 rounded-full bg-gradient-to-br from-cyan-500/70 to-violet-600/80 p-0.5">
                      <Avatar user={t.other} size={36} />
                    </Link>
                    <button onClick={() => setActiveId(t.id)} className="min-w-0 flex-1 cursor-pointer text-left">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t.other.name}</span>
                        {t.lastMessage && <span className="shrink-0 text-[10px] text-zinc-500">{timeAgo(t.lastMessage.createdAt)}</span>}
                      </span>
                      <span className="block truncate text-xs text-zinc-400">{t.lastMessage ? t.lastMessage.text : "Say hi — conversation started"}</span>
                    </button>
                  </div>
                ))}
                {visibleList.length === 0 && <p className="px-2 py-4 text-xs text-zinc-500">{list.length === 0 ? "No active conversations yet." : "No conversations match your search."}</p>}
              </div>
            </div>
          </aside>

          <section className="col-span-12 flex min-h-0 flex-col bg-white/30 md:col-span-8 dark:bg-zinc-950/40">
        {!active ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <EmptyState icon={<MessageCircle size={28} />} title="Pick a conversation" hint="Or start one from any profile's Message button." />
          </div>
        ) : active.status === "pending" ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <Avatar user={active.other} size={64} ring />
            <p className="font-semibold text-zinc-100">{active.other.name}</p>
            <p className="max-w-sm text-sm text-zinc-400">
              This is a message request. {active.requestedByMe ? "Your message is waiting for them to accept." : "Accept the request to keep chatting."}
            </p>
          </div>
        ) : (
          <>
            <header className="flex items-center gap-3 border-b border-slate-200/80 p-4 dark:border-zinc-800/80">
              <Link href={`/profile/${encodeURIComponent(active.other.handle)}`} aria-label={`Open ${active.other.name}'s profile`} className="shrink-0"><Avatar user={active.other} size={40} /></Link>
              <Link href={`/profile/${encodeURIComponent(active.other.handle)}`} className="min-w-0 flex-1 hover:text-violet-600 dark:hover:text-violet-400">
                <p className="font-semibold text-zinc-900 dark:text-zinc-100">{active.other.name}</p>
                <p className="truncate text-xs text-zinc-600 dark:text-zinc-400">@{active.other.handle} · {active.other.school}</p>
              </Link>
              <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-400">Active</span>
            </header>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {(active.lastMessage ? [active.lastMessage] : []).map((m) => (
                <div key={m.id} className={`flex ${m.senderId === active.other.id ? "justify-start" : "justify-end"}`}>
                  <div className={`max-w-[70%] p-3 text-sm backdrop-blur-sm ${m.senderId === active.other.id ? "rounded-2xl rounded-tl-xs border border-slate-200 bg-slate-100 text-zinc-900 dark:border-zinc-700/40 dark:bg-zinc-800/60 dark:text-zinc-200" : "ml-auto rounded-2xl rounded-tr-xs bg-violet-600 text-white shadow-lg shadow-violet-600/20"}`}>
                    {m.text}
                    <div className="mt-1 text-right text-[10px] text-zinc-400">{timeAgo(m.createdAt)}</div>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
            <div className="border-t border-zinc-200/80 bg-white/40 p-4 dark:border-zinc-800/80 dark:bg-zinc-900/40">
              <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-slate-100/90 px-4 py-2.5 transition-all focus-within:border-violet-500/50 focus-within:ring-1 focus-within:ring-violet-500/50 dark:border-zinc-800 dark:bg-zinc-900/80">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="Write a message..."
                className="w-full border-none bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-500 dark:text-zinc-100"
              />
                <button onClick={send} className="cursor-pointer rounded-lg bg-violet-600 p-2 text-white shadow-md shadow-violet-600/30 transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50" aria-label="Send" disabled={!draft.trim()}>
                  <Send size={16} />
                </button>
              </div>
            </div>
          </>
        )}
          </section>
        </div>
      </div>
    </div>
  );
}
