"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, Search, Send, Users } from "lucide-react";
import { api, post, type ThreadSummary, type PublicUser } from "@/lib/client";
import type { ChatMessage } from "@/lib/schema";
import { Avatar, EmptyState } from "@/components/ui/primitives";
import { useSession, useUI } from "@/components/providers";
import { createGroup, getGroupDetail, listGroups, searchUsers, sendGroupMessage, subscribeDmRealtime, type DmGroupDetail, type DmGroupSummary } from "@/lib/dm-backends";
import CreateGroupModal from "@/components/motion/CreateGroupModal";
import GroupInfoPanel from "@/components/motion/GroupInfoPanel";
import { timeAgo } from "@/lib/utils";

type Item = { id: string; senderId: string; text: string; createdAt: string };
type Active = { kind: "dm"; id: string } | { kind: "group"; id: string };

export default function MessagesPage() {
  const { me, refreshChats } = useSession();
  const { toast } = useUI();
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [groups, setGroups] = useState<DmGroupSummary[]>([]);
  const [active, setActive] = useState<Active | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [groupDetail, setGroupDetail] = useState<DmGroupDetail | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<PublicUser[]>([]);
  const [draft, setDraft] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const activeRef = useRef<Active>(null);
  activeRef.current = active;

  const reload = useCallback(async () => {
    const [chatResult, groupResult] = await Promise.allSettled([api<{ threads: ThreadSummary[] }>("/api/chats"), listGroups()]);
    if (chatResult.status === "fulfilled") setThreads(chatResult.value.threads);
    if (groupResult.status === "fulfilled") setGroups(groupResult.value);
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const groupId = new URLSearchParams(window.location.search).get("group");
    if (groupId) void loadFromUrl(groupId);
    async function loadFromUrl(id: string) {
      try { const result = await getGroupDetail(id); setGroupDetail(result.group); setItems(result.messages.map((m) => ({id:m.id,senderId:m.senderId,text:m.text,createdAt:m.createdAt}))); setActive({kind:"group",id}); }
      catch (e) { toast(e instanceof Error ? e.message : "Couldn't load group"); }
    }
  }, [toast]);

  useEffect(() => {
    const q = search.trim();
    if (!q) { setResults([]); return; }
    const timer = window.setTimeout(() => void searchUsers(q).then(setResults).catch(() => setResults([])), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadActive = useCallback(async (selected: Active) => {
    setActive(selected); setItems([]); setShowInfo(false); setGroupDetail(null);
    try {
      if (selected.kind === "group") {
        const detail = await getGroupDetail(selected.id);
        setGroupDetail(detail.group);
        setItems(detail.messages.map((m) => ({ id: m.id, senderId: m.senderId, text: m.text, createdAt: m.createdAt })));
      } else {
        const thread = threads.find((t) => t.id === selected.id);
        if (!thread) return;
        const response = await api<{ messages: ChatMessage[] }>(`/api/chats?chatId=${encodeURIComponent(selected.id)}`);
        setItems(response.messages.map((m) => ({ id: m.id, senderId: m.senderId, text: m.text, createdAt: m.createdAt })));
      }
    } catch (e) { toast(e instanceof Error ? e.message : "Couldn't load conversation"); }
  }, [threads, toast]);

  useEffect(() => {
    let alive = true;
    let unsubscribe = () => {};
    void subscribeDmRealtime({
      onDm: (m) => {
        const thread = threads.find((t) => t.other.id === m.senderId || t.other.id === m.receiverId);
        const current = activeRef.current;
        if (!alive || !current || current.kind !== "dm" || !thread || thread.id !== current.id) return;
        setItems((old) => old.some((x) => x.id === m.id) ? old : [...old, { id: m.id, senderId: m.senderId, text: m.text, createdAt: m.createdAt }].sort((a,b) => a.createdAt.localeCompare(b.createdAt)));
      },
      onGroup: (m) => { const current = activeRef.current; if (alive && current?.kind === "group" && current.id === m.groupId) setItems((old) => old.some((x) => x.id === m.id) ? old : [...old, { id: m.id, senderId: m.senderId, text: m.text, createdAt: m.createdAt }].sort((a,b) => a.createdAt.localeCompare(b.createdAt))); },
    }).then((unsub) => { if (alive) unsubscribe = unsub; else unsub(); });
    return () => { alive = false; unsubscribe(); };
  }, [threads]);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [items.length, active?.id]);

  const startUser = async (user: PublicUser) => {
    setSearch(""); setResults([]);
    try {
      const existing = threads.find((t) => t.other.id === user.id);
      if (existing) { await loadActive({ kind: "dm", id: existing.id }); return; }
      const result = await post<{ chatId: string }>("/api/chats", { action: "send", targetHandle: user.handle, text: "👋" });
      await reload();
      setActive({ kind: "dm", id: result.chatId });
      refreshChats();
    } catch (e) { toast(e instanceof Error ? e.message : "Could not start conversation"); }
  };

  const send = async () => {
    const text = draft.trim(); if (!active || !text) return; setDraft("");
    try {
      if (active.kind === "group") {
        await sendGroupMessage(active.id, text);
        // Legacy stores have no realtime — refetch so the sent message shows.
        const detail = await getGroupDetail(active.id);
        setGroupDetail(detail.group);
        setItems(detail.messages.map((m) => ({ id: m.id, senderId: m.senderId, text: m.text, createdAt: m.createdAt })));
      } else {
        await post("/api/chats", { action: "send", chatId: active.id, text });
        const r = await api<{ messages: ChatMessage[] }>(`/api/chats?chatId=${encodeURIComponent(active.id)}`);
        setItems(r.messages.map((m) => ({ id:m.id,senderId:m.senderId,text:m.text,createdAt:m.createdAt })));
      }
      refreshChats();
    } catch (e) { toast(e instanceof Error ? e.message : "Message failed to send"); setDraft(text); }
  };

  const dmThread = active?.kind === "dm" ? threads.find((t) => t.id === active.id) : null;
  const currentUserId = me?.id ?? groupDetail?.members.find((m) => m.user.isSelf)?.user.id ?? null;

  return <div className="min-h-[calc(100vh-5rem)] bg-slate-200/70 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
    <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-6xl flex-col px-4 py-6">
      <div className="grid h-[720px] grid-cols-12 overflow-hidden rounded-2xl border border-white/90 bg-white/80 shadow-xl backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-900/60">
        <aside className="col-span-12 flex flex-col border-r border-zinc-200/80 dark:border-zinc-800 md:col-span-4">
          <header className="border-b border-zinc-200/80 p-4 dark:border-zinc-800"><div className="mb-4 flex items-center justify-between"><h1 className="text-xl font-semibold">Messages</h1><button onClick={() => setCreateOpen(true)} aria-label="Create group" className="rounded-lg p-2 hover:bg-zinc-800/60"><Users size={17}/></button></div>
            <label className="relative block"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"/><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search people or conversations" aria-label="Search people" className="w-full rounded-xl border border-zinc-700/60 bg-zinc-800/50 px-3 py-2 pl-9 text-xs outline-none focus:border-violet-500"/>
              {!!results.length && <div className="absolute z-20 mt-2 max-h-64 w-full overflow-auto rounded-xl border border-zinc-800 bg-zinc-900/95 p-1 shadow-xl backdrop-blur-md">{results.map((u)=><button key={u.id} onClick={()=>void startUser(u)} className="flex w-full items-center gap-2 rounded-lg p-2 text-left hover:bg-zinc-800"><Avatar user={{id:u.id,name:u.name,photo:u.photo}} size={30}/><span className="text-xs">{u.name}<span className="block text-zinc-500">@{u.handle}</span></span></button>)}</div>}
            </label></header>
          <div className="flex-1 overflow-auto p-3">{groups.map((g)=><button key={g.id} onClick={()=>void loadActive({kind:"group",id:g.id})} className={`mb-1 flex w-full items-center gap-3 rounded-xl p-3 text-left hover:bg-zinc-800/40 ${active?.id===g.id?"bg-violet-600/10":""}`}><span className="grid size-9 place-items-center rounded-full bg-violet-600/20"><Users size={16}/></span><span className="min-w-0 flex-1"><b className="block truncate text-sm">{g.name}</b><small className="text-zinc-500">{g.lastMessage?.text ?? `${g.memberCount} members`}</small></span></button>)}{threads.map((t)=><button key={t.id} onClick={()=>void loadActive({kind:"dm",id:t.id})} className={`mb-1 flex w-full items-center gap-3 rounded-xl p-3 text-left hover:bg-zinc-800/40 ${active?.id===t.id?"bg-violet-600/10":""}`}><Avatar user={t.other} size={36}/><span className="min-w-0 flex-1"><b className="block truncate text-sm">{t.other.name}</b><small className="block truncate text-zinc-500">{t.lastMessage?.text ?? "Start a conversation"}</small></span></button>)}{threads.length===0&&groups.length===0&&<p className="p-3 text-xs text-zinc-500">Search for someone to start a conversation.</p>}</div>
        </aside>
        <section className="col-span-12 flex min-h-0 flex-col bg-zinc-950/20 md:col-span-8">{!active?<div className="flex flex-1 items-center justify-center"><EmptyState icon={<MessageCircle size={28}/>} title="Pick a conversation" hint="Search for someone or create a group."/></div>:<>
          <header className="flex items-center gap-3 border-b border-zinc-800 p-4">{active.kind==="group"?<button onClick={()=>setShowInfo(true)} className="flex min-w-0 flex-1 items-center gap-3 text-left"><span className="grid size-10 place-items-center rounded-xl bg-violet-600/20"><Users size={18}/></span><span><b className="block">{groupDetail?.name ?? groups.find(g=>g.id===active.id)?.name}</b><small className="text-zinc-500">{groupDetail?.memberCount ?? ""} members · Group chat</small></span></button>:dmThread&&<><Avatar user={dmThread.other} size={40}/><div><b className="block">{dmThread.other.name}</b><small className="text-zinc-500">@{dmThread.other.handle}</small></div></>}</header>
          {showInfo&&groupDetail?<GroupInfoPanel group={groupDetail} isCreator={groupDetail.createdBy===currentUserId} onClose={()=>setShowInfo(false)} onChanged={()=>void getGroupDetail(groupDetail.id).then((r)=>setGroupDetail(r.group))} onLeave={()=>{ setShowInfo(false); setActive(null); void reload(); }}/>:<><div className="flex-1 overflow-y-auto p-4">{items.map(m=>{ const mine = currentUserId ? m.senderId===currentUserId : m.senderId!==dmThread?.other.id; return <div key={m.id} className={`mb-3 flex ${mine?"justify-end":"justify-start"}`}><div className={`max-w-[75%] rounded-2xl p-3 text-sm ${mine?"bg-violet-600 text-white":"border border-zinc-700/40 bg-zinc-800/60"}`}>{m.text}<small className="mt-1 block text-right opacity-60">{timeAgo(m.createdAt)}</small></div></div>; })}<div ref={bottom}/></div><div className="border-t border-zinc-800 p-4"><div className="flex gap-2 rounded-xl border border-zinc-800 bg-zinc-900/80 px-4 py-2"><input value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.nativeEvent.isComposing&&void send()} placeholder="Write a message..." className="w-full bg-transparent text-sm outline-none"/><button onClick={()=>void send()} disabled={!draft.trim()}><Send size={17}/></button></div></div></>}
        </>}</section>
      </div>
    </div>
    {createOpen&&<CreateGroupModal onClose={()=>setCreateOpen(false)} onCreate={async(input)=>{const id=await createGroup(input);await reload();await loadActive({kind:"group",id});return id;}}/>}
  </div>;
}
