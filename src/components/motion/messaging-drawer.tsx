"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowLeft, MessageSquare, Search, Send, Users, X } from "lucide-react";
import { api, post, type ThreadSummary } from "@/lib/client";
import type { PublicUser } from "@/lib/schema";
import { createGroup, searchUsers } from "@/lib/dm-backends";
import CreateGroupModal from "@/components/motion/CreateGroupModal";
import type { ChatMessage } from "@/lib/schema";
import { timeAgo } from "@/lib/utils";
import { Avatar } from "@/components/ui/primitives";
import { hasSupabaseEnv } from "@/lib/db/supabase-env";

/* ───────────────────────────── types ───────────────────────────── */

type Res = { ok: boolean; status?: string };

/** Minimal peer identity — same shape across Supabase profiles and the legacy store. */
interface Peer {
  id: string;
  handle: string;
  name: string;
  photo?: string | null;
}

/** One open conversation, whichever backend backs it. */
interface OpenChat {
  mode: "supabase" | "legacy";
  key: string; // supabase: peer id · legacy: chat id
  peer: Peer;
  status: "active" | "pending";
  chatId?: string; // legacy only
}

/** Unified message row for rendering. */
interface UiMsg {
  id: string;
  senderId: string;
  text: string;
  createdAt: string;
  pending?: boolean;
}

/** Raw public.messages row. */
interface DmRow {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  read: boolean;
  created_at: string;
}

/* ───────────────────────── helpers ───────────────────────── */

const toPeerFromProfile = (p: {
  id: string;
  username: string;
  full_name: string | null;
  display_name: string | null;
  avatar_url: string | null;
}): Peer => ({ id: p.id, handle: p.username, name: p.display_name || p.full_name || p.username, photo: p.avatar_url });

const toPeerFromPublic = (u: {
  id: string;
  handle: string;
  name: string;
  photo?: string;
}): Peer => ({ id: u.id, handle: u.handle, name: u.name, photo: u.photo ?? null });

const dmToUi = (r: DmRow): UiMsg => ({ id: r.id, senderId: r.sender_id, text: r.content, createdAt: r.created_at });

const sortPair = (a: string, b: string) => [a, b].sort().join(":");

/* ───────────────────────── component ───────────────────────── */

export default function MessagingDrawer() {
  const pathname = usePathname();

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"supabase" | "legacy" | null>(null);
  const [booting, setBooting] = useState(false);

  // Peer list (supabase: accepted connections · legacy: thread summaries)
  const [peers, setPeers] = useState<Peer[]>([]);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [query, setQuery] = useState("");
  const [globalResults, setGlobalResults] = useState<PublicUser[]>([]);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);

  // Active conversation
  const [chat, setChat] = useState<OpenChat | null>(null);
  const [messages, setMessages] = useState<UiMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<OpenChat | null>(null);
  chatRef.current = chat;

  /* ── open / close ─────────────────────────────────────────── */

  const loadLegacyThreads = useCallback(async () => {
    const r = await api<{ threads: ThreadSummary[] }>("/api/chats");
    setThreads(r.threads);
    setPeers(r.threads.filter((t) => t.status !== "declined").map((t) => toPeerFromPublic(t.other)));
  }, []);

  const loadSupabasePeers = useCallback(async (myId: string): Promise<Peer[]> => {
    const { createClient } = await import("@/lib/supabase/client");
    const sb = createClient();

    const { data: conns, error: connErr } = await sb
      .from("connections")
      .select("requester_id,target_id")
      .eq("status", "accepted")
      .or(`requester_id.eq.${myId},target_id.eq.${myId}`);
    if (connErr) throw new Error(connErr.message);

    const otherIds = (conns ?? []).map((c) => (c.requester_id === myId ? c.target_id : c.requester_id));
    if (otherIds.length === 0) return [];
    const { data: profileRows, error: profErr } = await sb
      .from("profiles")
      .select("id,username,full_name,display_name,avatar_url")
      .in("id", otherIds);
    if (profErr) throw new Error(profErr.message);
    return (profileRows ?? []).map(toPeerFromProfile);
  }, []);

  /** Resolve the backend once per drawer-open: Supabase session first, legacy store otherwise. */
  const boot = useCallback(async () => {
    setBooting(true);
    setLoadError(null);
    try {
      if (hasSupabaseEnv()) {
        try {
          const { createClient } = await import("@/lib/supabase/client");
          const sb = createClient();
          const {
            data: { user },
          } = await sb.auth.getUser();
          if (user) {
            const list = await loadSupabasePeers(user.id);
            setMode("supabase");
            setPeers(list);
            setThreads([]);
            return;
          }
        } catch (e) {
          console.warn("[dm] Supabase unavailable — using the local store:", e instanceof Error ? e.message : e);
        }
      }
      await loadLegacyThreads();
      setMode("legacy");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Couldn't load conversations");
      setMode("legacy");
    } finally {
      setBooting(false);
    }
  }, [loadLegacyThreads, loadSupabasePeers]);

  useEffect(() => {
    if (open) void boot();
  }, [open, boot]);

  useEffect(() => {
    const q = query.trim();
    if (!open || chat || !q) { setGlobalResults([]); return; }
    const timer = window.setTimeout(() => void searchUsers(q).then(setGlobalResults).catch(() => setGlobalResults([])), 250);
    return () => window.clearTimeout(timer);
  }, [query, open, chat]);

  /* ── Supabase realtime — append incoming messages instantly ── */

  useEffect(() => {
    if (!open || mode !== "supabase" || !chat) return;
    let channel: import("@supabase/supabase-js").RealtimeChannel | null = null;
    let cancelled = false;

    void (async () => {
      try {
        const { createClient } = await import("@/lib/supabase/client");
        const sb = createClient();
        const ch = sb
          .channel(`dm-${sortPair(chat.key, chat.peer.id)}`)
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "messages" },
            (payload) => {
              const row = payload.new as DmRow;
              const current = chatRef.current;
              if (!current || current.mode !== "supabase") return;
              const between =
                (row.sender_id === current.peer.id && row.receiver_id === current.key) ||
                (row.sender_id === current.key && row.receiver_id === current.peer.id);
              if (!between) return;
              setMessages((cur) => (cur.some((m) => m.id === row.id) ? cur : [...cur, dmToUi(row)]));
            }
          )
          .subscribe();
        if (cancelled) {
          void sb.removeChannel(ch);
          return;
        }
        channel = ch;
      } catch (e) {
        console.warn("[dm] realtime subscription failed:", e instanceof Error ? e.message : e);
      }
    })();

    return () => {
      cancelled = true;
      if (channel) {
        void import("@/lib/supabase/client").then(({ createClient }) => {
          void createClient().removeChannel(channel!);
        });
      }
    };
  }, [open, mode, chat]);

  /* ── legacy mode — poll the open chat so replies appear live ── */

  useEffect(() => {
    if (!open || mode !== "legacy" || !chat || chat.status !== "active") return;

    let alive = true;
    const tick = async () => {
      try {
        const r = await api<{ messages: ChatMessage[] }>(`/api/chats?chatId=${encodeURIComponent(chat.key)}`);
        if (!alive) return;
        setMessages((cur) => {
          const known = new Set(cur.filter((m) => !m.pending).map((m) => m.id));
          const fresh = r.messages.filter((m) => !known.has(m.id)).map((m) => ({ id: m.id, senderId: m.senderId, text: m.text, createdAt: m.createdAt }));
          return fresh.length > 0 ? [...cur.filter((m) => !m.pending), ...fresh] : cur;
        });
      } catch {
        /* transient — the next tick retries */
      }
    };
    const timer = window.setInterval(tick, 4000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [open, mode, chat]);

  /* ── open a conversation ──────────────────────────────────── */

  const openLegacyChat = useCallback(async (thread: ThreadSummary) => {
    setChat({ mode: "legacy", key: thread.id, peer: toPeerFromPublic(thread.other), status: thread.status === "pending" ? "pending" : "active", chatId: thread.id });
    setMessages([]);
    try {
      const r = await api<{ messages: ChatMessage[] }>(`/api/chats?chatId=${encodeURIComponent(thread.id)}`);
      setMessages(r.messages.map((m) => ({ id: m.id, senderId: m.senderId, text: m.text, createdAt: m.createdAt })));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Couldn't load this conversation");
    }
  }, []);

  const openSupabaseChat = useCallback(
    async (peer: Peer, myId: string) => {
      setChat({ mode: "supabase", key: myId, peer, status: "active" });
      setMessages([]);
      try {
        const { createClient } = await import("@/lib/supabase/client");
        const sb = createClient();
        const pair = `and(sender_id.eq.${myId},receiver_id.eq.${peer.id}),and(sender_id.eq.${peer.id},receiver_id.eq.${myId})`;
        const { data: rows, error } = await sb
          .from("messages")
          .select("*")
          .or(pair)
          .order("created_at", { ascending: true })
          .limit(300);
        if (error) throw new Error(error.message);
        setMessages(((rows ?? []) as DmRow[]).map(dmToUi));

        // Best-effort read receipts for what we just loaded.
        void sb
          .from("messages")
          .update({ read: true })
          .eq("receiver_id", myId)
          .eq("sender_id", peer.id)
          .eq("read", false)
          .then(undefined, () => {});
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Couldn't load this conversation");
      }
    },
    []
  );

  const openChatWith = useCallback(
    (peer: Peer) => {
      if (mode === "supabase") {
        // myId is known in supabase mode — it came from the auth session at boot.
        void import("@/lib/supabase/client").then(async ({ createClient }) => {
          const {
            data: { user },
          } = await createClient().auth.getUser();
          if (user) await openSupabaseChat(peer, user.id);
        });
      } else {
        // Legacy: reuse the existing thread (or create a pending one) by handle.
        const existing = threads.find((t) => t.other.id === peer.id);
        if (existing) {
          void openLegacyChat(existing);
        } else {
          void (async () => {
            try {
              const r = await post<{ ok: boolean; status?: string; chatId?: string }>("/api/chats", {
                targetHandle: peer.handle,
                text: "👋",
              });
              const refreshed = await api<{ threads: ThreadSummary[] }>("/api/chats");
              setThreads(refreshed.threads);
              const t = refreshed.threads.find((x) => x.id === r.chatId);
              if (t) await openLegacyChat(t);
            } catch (e) {
              setLoadError(e instanceof Error ? e.message : "Couldn't start this conversation");
            }
          })();
        }
      }
    },
    [mode, threads, openLegacyChat, openSupabaseChat]
  );

  /* ── send ─────────────────────────────────────────────────── */

  const send = useCallback(async () => {
    const current = chat;
    const text = draft.trim();
    if (!current || !text || current.status !== "active") return;
    setDraft("");
    setSending(true);

    if (current.mode === "supabase") {
      const optimisticId = `tmp-${Date.now()}`;
      setMessages((cur) => [...cur, { id: optimisticId, senderId: current.key, text, createdAt: new Date().toISOString(), pending: true }]);
      try {
        const { createClient } = await import("@/lib/supabase/client");
        const sb = createClient();
        const { data: row, error } = await sb
          .from("messages")
          .insert({ sender_id: current.key, receiver_id: current.peer.id, content: text })
          .select("*")
          .single();
        if (error) throw new Error(error.message);
        // The realtime INSERT may also deliver this row — replace the
        // optimistic bubble and de-dupe by id so it appears exactly once.
        const persisted = dmToUi(row as DmRow);
        setMessages((cur) => {
          const mapped = cur.map((m) => (m.id === optimisticId ? persisted : m));
          return Array.from(new Map(mapped.map((m) => [m.id, m])).values());
        });
      } catch (e) {
        setMessages((cur) => cur.filter((m) => m.id !== optimisticId));
        setLoadError(e instanceof Error ? e.message : "Message failed to send");
      } finally {
        setSending(false);
      }
      return;
    }

    // Legacy store
    try {
      await post<Res>("/api/chats", { action: "send", chatId: current.chatId, text });
      const r = await api<{ messages: ChatMessage[] }>(`/api/chats?chatId=${encodeURIComponent(current.chatId!)}`);
      setMessages(r.messages.map((m) => ({ id: m.id, senderId: m.senderId, text: m.text, createdAt: m.createdAt })));
      void loadLegacyThreads();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Message failed to send");
    } finally {
      setSending(false);
    }
  }, [chat, draft, loadLegacyThreads]);

  /* ── auto-scroll to the latest message ────────────────────── */

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    });
  }, [messages.length, chat?.key]);

  const closeChat = () => {
    setChat(null);
    setMessages([]);
    setDraft("");
    setLoadError(null);
    if (mode === "legacy") void loadLegacyThreads();
  };

  /* ── derived ──────────────────────────────────────────────── */

  const normalizedQuery = query.trim().toLowerCase();
  const visibleThreads = threads
    .filter((t) => t.status !== "declined")
    .filter((t) => {
      if (!normalizedQuery) return true;
      return [t.other.name, t.other.handle, t.lastMessage?.text ?? ""].some((v) => v.toLowerCase().includes(normalizedQuery));
    });
  const visiblePeers = peers.filter((p) =>
    normalizedQuery ? p.name.toLowerCase().includes(normalizedQuery) || p.handle.toLowerCase().includes(normalizedQuery) : true
  );
  const unread = threads.filter((t) => t.unreadPreview).length;

  if (pathname.startsWith("/settings")) return null;

  /* ── render ───────────────────────────────────────────────── */

  return (
    <div className="pointer-events-auto fixed bottom-5 right-6 z-[9999]">
      {open && (
        <section
          className="mb-3 flex h-[440px] w-80 flex-col overflow-hidden rounded-2xl border border-slate-300/80 bg-white/80 text-zinc-900 shadow-2xl shadow-slate-300/60 backdrop-blur-xl animate-in fade-in slide-in-from-bottom-2 duration-200 dark:border-zinc-800/80 dark:bg-zinc-900/60 dark:text-zinc-100 dark:shadow-none sm:w-96"
          aria-label="Messages"
        >
          <header className="flex items-center justify-between border-b border-slate-300/80 p-4 dark:border-zinc-800/80">
            <div className="flex min-w-0 items-center gap-2">
              {chat && (
                <button
                  onClick={closeChat}
                  className="rounded-lg p-1 text-zinc-500 hover:bg-slate-200 dark:hover:bg-zinc-800"
                  aria-label="Back to conversations"
                >
                  <ArrowLeft size={16} />
                </button>
              )}
              {chat ? (
                <Link
                  href={`/profile/${encodeURIComponent(chat.peer.handle)}`}
                  onClick={(e) => e.stopPropagation()}
                  className="truncate text-sm font-semibold hover:text-violet-600 dark:hover:text-violet-400"
                >
                  {chat.peer.name}
                </Link>
              ) : (
                <h2 className="truncate text-sm font-semibold">
                  Messages{" "}
                  {mode && (
                    <span className="ml-1 align-middle text-[9px] font-medium uppercase tracking-wider text-zinc-400">
                      {mode === "supabase" ? "live" : ""}
                    </span>
                  )}
                </h2>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!chat && (
                <Link href="/messages" className="text-xs text-violet-600 hover:underline dark:text-violet-400">
                  View all
                </Link>
              )}
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg p-1 text-zinc-500 hover:bg-slate-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                aria-label="Close messages"
              >
                <X size={17} />
              </button>
            </div>
          </header>

          {chat ? (
            <>
              {/* Peer header */}
              <div className="flex items-center gap-2 border-b border-slate-300/80 px-4 py-3 dark:border-zinc-800/80">
                <Link
                  href={`/profile/${encodeURIComponent(chat.peer.handle)}`}
                  onClick={(e) => e.stopPropagation()}
                  className="relative shrink-0"
                  aria-label={`Open ${chat.peer.name}'s profile`}
                >
                  <Avatar user={{ id: chat.peer.id, name: chat.peer.name, photo: chat.peer.photo ?? undefined }} size={32} />
                  <span className="absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-white bg-emerald-500 dark:border-zinc-900" />
                </Link>
                <Link
                  href={`/profile/${encodeURIComponent(chat.peer.handle)}`}
                  onClick={(e) => e.stopPropagation()}
                  className="min-w-0 hover:text-violet-600 dark:hover:text-violet-400"
                >
                  <p className="truncate text-xs font-semibold">{chat.peer.name}</p>
                  <p className="truncate text-[10px] text-zinc-500">@{chat.peer.handle}</p>
                </Link>
              </div>

              {/* Message stream */}
              <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-4">
                {messages.length === 0 && !loadError && (
                  <p className="text-center text-xs text-zinc-500">Start the conversation.</p>
                )}
                {loadError && <p className="text-center text-xs text-rose-500 dark:text-rose-400">{loadError}</p>}
                {messages.map((m) => {
                  const mine = chat.mode === "supabase" ? m.senderId === chat.key : m.senderId !== chat.peer.id;
                  return (
                    <div
                      key={m.id}
                      className={`max-w-[80%] rounded-2xl p-2.5 text-xs ${
                        mine
                          ? "ml-auto bg-violet-600 text-white"
                          : "border border-slate-200 bg-slate-100 text-zinc-900 dark:border-zinc-700/40 dark:bg-zinc-800/60 dark:text-zinc-200"
                      } ${m.pending ? "opacity-60" : ""}`}
                    >
                      {m.text}
                      <div className="mt-1 text-right text-[9px] opacity-60">
                        {m.pending ? "sending…" : timeAgo(m.createdAt)}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Composer */}
              {chat.status === "pending" ? (
                <div className="border-t border-slate-300/80 p-3 text-center text-[11px] text-zinc-500 dark:border-zinc-800/80 dark:text-zinc-400">
                  Request sent — you can chat once it&apos;s accepted.
                </div>
              ) : (
                <div className="border-t border-slate-300/80 p-3 dark:border-zinc-800/80">
                  <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-slate-100/90 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-800/50">
                    <input
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                          event.preventDefault();
                          void send();
                        }
                      }}
                      placeholder="Message…"
                      className="w-full bg-transparent text-xs text-zinc-900 outline-none placeholder:text-zinc-500 dark:text-zinc-100"
                      aria-label="Message"
                    />
                    <button
                      onClick={() => void send()}
                      disabled={!draft.trim() || sending}
                      className="rounded-lg bg-violet-600 p-1.5 text-white disabled:opacity-40"
                      aria-label="Send message"
                    >
                      <Send size={13} />
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Search */}
              <div className="mx-4 mt-3 flex items-center gap-2">
              <label className="relative block flex-1">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search people or messages"
                  className="w-full rounded-xl border border-slate-300 bg-slate-100 px-3 py-2 pl-8 text-xs text-zinc-900 outline-none focus:border-violet-500 dark:border-zinc-700/60 dark:bg-zinc-800/50 dark:text-zinc-100"
                  aria-label="Search messages"
                />
              </label>
              <button onClick={() => setCreateGroupOpen(true)} className="rounded-xl border border-zinc-700/60 bg-zinc-800/50 p-2 text-zinc-400 hover:border-violet-500/50 hover:text-violet-300" aria-label="Create group chat"><Users size={15}/></button>
              </div>

              {/* Peer list */}
              <div className="flex-1 overflow-y-auto p-3">
                {globalResults.length > 0 && <div className="mb-2 rounded-xl border border-zinc-800 bg-zinc-900/70 p-1">{globalResults.map((u) => <button key={u.id} onClick={() => { setGlobalResults([]); openChatWith({ id:u.id, handle:u.handle, name:u.name, photo:u.photo ?? null }); }} className="flex w-full items-center gap-2 rounded-lg p-2 text-left hover:bg-zinc-800/70"><Avatar user={{id:u.id,name:u.name,photo:u.photo}} size={30}/><span className="min-w-0"><span className="block truncate text-xs font-semibold">{u.name}</span><span className="block truncate text-[11px] text-zinc-500">@{u.handle}</span></span></button>)}</div>}
                {booting && <p className="p-3 text-xs text-zinc-500">Loading conversations…</p>}
                {!booting && loadError && <p className="p-3 text-xs text-rose-500 dark:text-rose-400">{loadError}</p>}

                {!booting && mode === "supabase" && (
                  <>
                    {visiblePeers.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => openChatWith(p)}
                        className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl p-2.5 text-left transition hover:bg-slate-200/60 dark:hover:bg-zinc-800/40"
                      >
                        <span className="relative shrink-0">
                          <Avatar user={{ id: p.id, name: p.name, photo: p.photo ?? undefined }} size={34} />
                          <span className="absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-white bg-emerald-500 dark:border-zinc-900" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-semibold">{p.name}</span>
                          <span className="block truncate text-[11px] text-zinc-500">@{p.handle}</span>
                        </span>
                      </button>
                    ))}
                    {visiblePeers.length === 0 && (
                      <p className="p-3 text-xs text-zinc-500">Connect with people to start chatting.</p>
                    )}
                  </>
                )}

                {!booting && mode === "legacy" && (
                  <>
                    {visibleThreads.map((thread) => (
                      <div
                        key={thread.id}
                        className="flex w-full items-center gap-2.5 rounded-xl p-2.5 text-left transition hover:bg-slate-200/60 dark:hover:bg-zinc-800/40"
                      >
                        <Link
                          href={`/profile/${encodeURIComponent(thread.other.handle)}`}
                          onClick={(e) => e.stopPropagation()}
                          className="relative shrink-0"
                          aria-label={`Open ${thread.other.name}'s profile`}
                        >
                          <Avatar user={thread.other} size={34} />
                          <span className="absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-white bg-emerald-500 dark:border-zinc-900" />
                        </Link>
                        <button
                          onClick={() => void openLegacyChat(thread)}
                          className="min-w-0 flex-1 cursor-pointer text-left"
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-semibold">
                              {thread.other.name}
                              {thread.unreadPreview && (
                                <span className="ml-2 rounded-full bg-violet-600 px-1.5 py-0.5 text-[8px] font-bold uppercase text-white">
                                  request
                                </span>
                              )}
                            </span>
                            {thread.lastMessage && (
                              <span className="shrink-0 text-[9px] text-zinc-500">{timeAgo(thread.lastMessage.createdAt)}</span>
                            )}
                          </span>
                          <span className="block truncate text-[11px] text-zinc-500">
                            {thread.lastMessage?.text ?? "Say hi — conversation started"}
                          </span>
                        </button>
                      </div>
                    ))}
                    {visibleThreads.length === 0 && <p className="p-3 text-xs text-zinc-500">No conversations found.</p>}
                  </>
                )}
              </div>
            </>
          )}
        </section>
      )}

      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="flex cursor-pointer items-center gap-2.5 rounded-full border border-slate-300/80 bg-white/90 px-4 py-2.5 text-sm font-medium text-zinc-900 shadow-xl shadow-slate-300/50 backdrop-blur-md transition-all hover:border-violet-400 dark:border-zinc-800/90 dark:bg-zinc-900/90 dark:text-zinc-100 dark:shadow-none dark:hover:border-violet-500/50"
          aria-label="Open messages"
        >
          <MessageSquare size={17} className="text-violet-600 dark:text-violet-400" />
          <span>Messages</span>
          {unread > 0 && <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-bold text-white">{unread}</span>}
        </button>
      )}
      {createGroupOpen && <CreateGroupModal onClose={() => setCreateGroupOpen(false)} onCreate={async (input) => { const id = await createGroup(input); setCreateGroupOpen(false); setOpen(false); window.location.assign(`/messages?group=${encodeURIComponent(id)}`); return id; }} />}
    </div>
  );
}
