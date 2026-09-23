"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowLeft, MessageSquare, Search, Send, X } from "lucide-react";
import { api, post, type ThreadSummary } from "@/lib/client";
import { timeAgo } from "@/lib/utils";
import { Avatar } from "@/components/ui/primitives";

type Res = { ok: boolean; status?: string };

export default function FloatingChatWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<{ threads: ThreadSummary[] }>("/api/chats");
      setThreads(result.threads);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Failed to load messages");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [load, open]);

  const active = threads.find((thread) => thread.id === selectedId) ?? null;
  const visibleThreads = threads
    .filter((thread) => thread.status !== "declined")
    .filter((thread) => {
      const normalized = query.trim().toLowerCase();
      if (!normalized) return true;
      return [thread.other.name, thread.other.handle, thread.lastMessage?.text ?? ""].some((value) => value.toLowerCase().includes(normalized));
    });
  const unread = threads.filter((thread) => thread.unreadPreview).length;

  if (pathname.startsWith("/settings")) return null;

  async function send() {
    if (!active || !draft.trim() || active.status !== "active") return;
    const text = draft.trim();
    setDraft("");
    try {
      await post<Res>("/api/chats", { action: "send", chatId: active.id, text });
      await load();
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Failed to send message");
    }
  }

  return (
    <div className="pointer-events-auto fixed bottom-5 right-6 z-[9999]">
      {open && (
        <section className="mb-3 flex h-[420px] w-80 flex-col overflow-hidden rounded-2xl border border-slate-300/80 bg-slate-100/95 text-zinc-900 shadow-2xl shadow-slate-300/60 backdrop-blur-xl animate-in fade-in slide-in-from-bottom-2 duration-200 dark:border-zinc-800/90 dark:bg-zinc-900/95 dark:text-zinc-100 dark:shadow-none sm:w-96" aria-label="Quick Messages">
          <header className="flex items-center justify-between border-b border-slate-300/80 p-4 dark:border-zinc-800/80">
            <div className="flex min-w-0 items-center gap-2">
              {active && <button onClick={() => setSelectedId(null)} className="rounded-lg p-1 text-zinc-500 hover:bg-slate-200 dark:hover:bg-zinc-800" aria-label="Back to conversations"><ArrowLeft size={16} /></button>}
              {active ? (
                <Link
                  href={`/profile/${encodeURIComponent(active.other.handle)}`}
                  onClick={(e) => e.stopPropagation()}
                  className="truncate text-sm font-semibold hover:text-violet-600 dark:hover:text-violet-400"
                >
                  {active.other.name}
                </Link>
              ) : (
                <h2 className="truncate text-sm font-semibold">Quick Messages</h2>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!active && <Link href="/messages" className="text-xs text-violet-600 hover:underline dark:text-violet-400">View all</Link>}
              <button onClick={() => setOpen(false)} className="rounded-lg p-1 text-zinc-500 hover:bg-slate-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100" aria-label="Close quick messages"><X size={17} /></button>
            </div>
          </header>

          {active ? (
            <>
              <div className="flex items-center gap-2 border-b border-slate-300/80 px-4 py-3 dark:border-zinc-800/80">
                <Link href={`/profile/${encodeURIComponent(active.other.handle)}`} onClick={(e) => e.stopPropagation()} className="relative shrink-0" aria-label={`Open ${active.other.name}'s profile`}><Avatar user={active.other} size={32} /><span className="absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-slate-100 bg-emerald-500 dark:border-zinc-900" /></Link>
                <Link href={`/profile/${encodeURIComponent(active.other.handle)}`} onClick={(e) => e.stopPropagation()} className="min-w-0 hover:text-violet-600 dark:hover:text-violet-400"><p className="truncate text-xs font-semibold">{active.other.name}</p><p className="truncate text-[10px] text-zinc-500">@{active.other.handle}</p></Link>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto p-4">
                {active.lastMessage ? <div className={`max-w-[80%] rounded-2xl p-2.5 text-xs ${active.lastMessage.senderId === active.other.id ? "border border-slate-200 bg-slate-100 text-zinc-900 dark:border-zinc-700/40 dark:bg-zinc-800/60 dark:text-zinc-200" : "ml-auto bg-violet-600 text-white"}`}>{active.lastMessage.text}<div className="mt-1 text-right text-[9px] opacity-60">{timeAgo(active.lastMessage.createdAt)}</div></div> : <p className="text-center text-xs text-zinc-500">Start the conversation.</p>}
              </div>
              <div className="border-t border-slate-300/80 p-3 dark:border-zinc-800/80">
                <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-slate-100/90 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-800/50">
                  <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void send()} placeholder="Quick reply..." className="w-full bg-transparent text-xs text-zinc-900 outline-none placeholder:text-zinc-500 dark:text-zinc-100" aria-label="Quick reply" />
                  <button onClick={() => void send()} disabled={!draft.trim() || active.status !== "active"} className="rounded-lg bg-violet-600 p-1.5 text-white disabled:opacity-40" aria-label="Send quick reply"><Send size={13} /></button>
                </div>
              </div>
            </>
          ) : (
            <>
              <label className="relative mx-4 mt-3 block">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search messages" className="w-full rounded-xl border border-slate-300 bg-slate-100 px-3 py-2 pl-8 text-xs text-zinc-900 outline-none focus:border-violet-500 dark:border-zinc-700/60 dark:bg-zinc-800/50 dark:text-zinc-100" aria-label="Search quick messages" />
              </label>
              <div className="flex-1 overflow-y-auto p-3">
                {loading ? <p className="p-3 text-xs text-zinc-500">Loading conversations...</p> : visibleThreads.map((thread) => (
                  <div key={thread.id} className="flex w-full items-center gap-2.5 rounded-xl p-2.5 text-left transition hover:bg-slate-200/60 dark:hover:bg-zinc-800/40">
                    <Link href={`/profile/${encodeURIComponent(thread.other.handle)}`} onClick={(e) => e.stopPropagation()} className="relative shrink-0" aria-label={`Open ${thread.other.name}'s profile`}><Avatar user={thread.other} size={34} /><span className="absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-slate-100 bg-emerald-500 dark:border-zinc-900" /></Link>
                    <button onClick={() => setSelectedId(thread.id)} className="min-w-0 flex-1 cursor-pointer text-left">
                      <span className="flex items-center justify-between gap-2"><span className="truncate text-xs font-semibold">{thread.other.name}</span>{thread.lastMessage && <span className="shrink-0 text-[9px] text-zinc-500">{timeAgo(thread.lastMessage.createdAt)}</span>}</span>
                      <span className="block truncate text-[11px] text-zinc-500">{thread.lastMessage?.text ?? "Say hi — conversation started"}</span>
                    </button>
                  </div>
                ))}
                {!loading && visibleThreads.length === 0 && <p className="p-3 text-xs text-zinc-500">No conversations found.</p>}
              </div>
            </>
          )}
        </section>
      )}

      {!open && (
        <button onClick={() => setOpen(true)} className="flex cursor-pointer items-center gap-2.5 rounded-full border border-slate-300/80 bg-white/90 px-4 py-2.5 text-sm font-medium text-zinc-900 shadow-xl shadow-slate-300/50 backdrop-blur-md transition-all hover:border-violet-400 dark:border-zinc-800/90 dark:bg-zinc-900/90 dark:text-zinc-100 dark:shadow-none dark:hover:border-violet-500/50" aria-label="Open messages">
          <MessageSquare size={17} className="text-violet-600 dark:text-violet-400" />
          <span>Messages</span>
          {unread > 0 && <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-bold text-white">{unread}</span>}
        </button>
      )}
    </div>
  );
}
