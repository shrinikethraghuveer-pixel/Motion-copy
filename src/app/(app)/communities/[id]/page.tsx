"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, LockKeyhole, MessageCircle, Pin, Send, Shield, Users } from "lucide-react";
import { api, post as sendPost, type PublicUser } from "@/lib/client";
import { useUI } from "@/components/providers";
import { Avatar } from "@/components/ui/primitives";
import { timeAgo } from "@/lib/utils";

type Member = PublicUser & { role: string };
type Reply = { id: string; text: string; createdAt: string; author: PublicUser };
type Discussion = { id: string; text: string; createdAt: string; pinned: boolean; author: PublicUser; replies: Reply[] };
type CommunityDetail = {
  id: string; name: string; tag: string; tags: string[]; description: string; visibility: "public" | "private";
  avatarUrl: string | null; memberCount: number; myRole: string | null; myRequestStatus: "member" | "pending" | "none"; members: Member[];
  requests: Array<PublicUser & { requestedAt: string }>; posts: Discussion[];
};

export default function CommunityPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useUI();
  const [community, setCommunity] = useState<CommunityDetail | null>(null);
  const [message, setMessage] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setCommunity((await api<{ community: CommunityDetail }>(`/api/groups/${id}`)).community); }
    catch (error) { toast(error instanceof Error ? error.message : "Could not load community."); }
  }, [id, toast]);
  useEffect(() => { void load(); }, [load]);

  async function action(body: Record<string, unknown>) {
    setBusy(true);
    try { await sendPost(`/api/groups/${id}`, body); await load(); }
    catch (error) { toast(error instanceof Error ? error.message : "That action failed."); }
    finally { setBusy(false); }
  }
  async function publish(event: React.FormEvent) {
    event.preventDefault();
    if (!message.trim()) return;
    await action({ action: "post", text: message });
    setMessage("");
  }

  if (!community) return <main className="mx-auto min-h-[70vh] max-w-5xl animate-pulse p-6"><div className="h-48 rounded-3xl bg-zinc-900" /></main>;
  const isMember = Boolean(community.myRole);
  const canModerate = community.myRole === "admin" || community.myRole === "moderator";
  const isAdmin = community.myRole === "admin";

  return (
    <main className="mx-auto min-h-[calc(100vh-5rem)] max-w-6xl px-4 py-6 text-zinc-100">
      <Link href="/explore" className="mb-5 inline-flex items-center gap-2 text-sm text-zinc-400 transition hover:text-violet-300"><ArrowLeft size={16} /> Explore communities</Link>
      <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-violet-950/70 via-zinc-900 to-zinc-950 p-6 sm:p-9">
        <div className="pointer-events-none absolute -right-10 -top-24 size-72 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="relative flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
          <div className="flex items-start gap-4">
            {community.avatarUrl ? <img src={community.avatarUrl} alt="" className="size-16 rounded-2xl object-cover" /> : <div className="grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-cyan-500 text-2xl font-bold">{community.name.slice(0, 1).toUpperCase()}</div>}
            <div><div className="flex flex-wrap items-center gap-2"><h1 className="text-3xl font-bold tracking-tight">{community.name}</h1><span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-300">{community.visibility === "private" ? <><LockKeyhole size={12} className="mr-1 inline" />Private</> : "Public"}</span></div>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-300">{community.description}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-400"><span className="inline-flex items-center gap-1"><Users size={13} />{community.memberCount} members</span>{community.tags.map((tag) => <span key={tag} className="rounded-full bg-white/[.07] px-2.5 py-1 text-violet-200">#{tag}</span>)}</div>
            </div>
          </div>
          {isMember ? <button disabled={busy || isAdmin && community.memberCount === 1} onClick={() => void action({ action: "leave" })} className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-zinc-300 transition hover:border-rose-400/40 hover:text-rose-300 disabled:opacity-40">Leave community</button> : community.myRequestStatus === "pending" ? <span className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-2.5 text-sm font-semibold text-amber-200">Request pending</span> : <button disabled={busy} onClick={() => { void sendPost("/api/groups", { action: "join", groupId: community.id }).then(load).catch((e) => toast(e.message)); }} className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold shadow-lg shadow-violet-950/50 transition hover:bg-violet-500">{community.visibility === "private" ? "Request to Join" : "Join community"}</button>}
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="min-w-0">
          <div className="mb-4 flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-cyan-300">Community space</p><h2 className="mt-1 text-xl font-bold">Discussions &amp; announcements</h2></div><span className="rounded-full border border-white/10 bg-white/[.04] px-3 py-1 text-xs text-zinc-400">Latest first</span></div>
          {isMember && <form onSubmit={publish} className="mb-4 rounded-2xl border border-violet-400/20 bg-zinc-900/75 p-4 shadow-[0_8px_40px_rgba(109,40,217,.08)]"><textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} rows={3} placeholder="Share an update, question, or idea with the community…" className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-zinc-500" /><div className="mt-3 flex items-center justify-between border-t border-white/[.07] pt-3"><span className="text-xs text-zinc-500">Keep it kind. Keep it moving.</span><button disabled={busy || !message.trim()} className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold disabled:opacity-40"><Send size={13} />Post</button></div></form>}
          {!isMember && <div className="mb-4 rounded-2xl border border-white/10 bg-zinc-900/60 p-5 text-sm text-zinc-400">Join this community to take part in discussions{community.visibility === "private" ? " and see member posts" : ""}.</div>}
          <div className="space-y-3">{community.posts.map((item) => <article key={item.id} className="rounded-2xl border border-white/[.08] bg-zinc-900/65 p-4 sm:p-5">
            {item.pinned && <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-violet-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-violet-300"><Pin size={11} />Pinned announcement</p>}
            <div className="flex gap-3"><Avatar user={item.author} size={38} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">{item.author.name}</span><span className="text-xs text-zinc-500">@{item.author.handle} · {timeAgo(item.createdAt)}</span></div><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">{item.text}</p>
              {canModerate && <button disabled={busy} onClick={() => void action({ action: "pin", postId: item.id })} className="mt-3 inline-flex items-center gap-1 text-xs text-violet-300 hover:text-violet-200"><Pin size={12} />{item.pinned ? "Unpin" : "Pin announcement"}</button>}
              {item.replies.length > 0 && <div className="mt-4 space-y-3 border-l border-white/10 pl-4">{item.replies.map((reply) => <div key={reply.id} className="flex gap-2.5"><Avatar user={reply.author} size={26} /><div><p className="text-xs font-semibold">{reply.author.name}<span className="ml-2 font-normal text-zinc-500">{timeAgo(reply.createdAt)}</span></p><p className="mt-1 whitespace-pre-wrap text-sm text-zinc-300">{reply.text}</p></div></div>)}</div>}
              {isMember && <form onSubmit={(event) => { event.preventDefault(); const text = replyDrafts[item.id] ?? ""; if (!text.trim()) return; void action({ action: "reply", postId: item.id, text }).then(() => setReplyDrafts((drafts) => ({ ...drafts, [item.id]: "" }))); }} className="mt-3 flex items-center gap-2"><MessageCircle size={14} className="text-zinc-500" /><input value={replyDrafts[item.id] ?? ""} onChange={(e) => setReplyDrafts((drafts) => ({ ...drafts, [item.id]: e.target.value }))} placeholder="Reply to this thread…" className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-zinc-500" /><button disabled={busy || !(replyDrafts[item.id] ?? "").trim()} className="text-xs font-semibold text-violet-300 disabled:opacity-30">Reply</button></form>}
            </div></div>
          </article>)}{community.posts.length === 0 && <div className="rounded-2xl border border-dashed border-white/10 px-6 py-12 text-center"><MessageCircle className="mx-auto text-violet-300" /><h3 className="mt-3 font-semibold">A fresh page</h3><p className="mt-1 text-sm text-zinc-500">Start a discussion and get the conversation moving.</p></div>}</div>
        </section>

        <aside className="space-y-4">
          {canModerate && <section className="rounded-2xl border border-violet-400/20 bg-violet-500/[.06] p-4"><h2 className="flex items-center gap-2 font-semibold"><Shield size={16} className="text-violet-300" />Join requests <span className="ml-auto rounded-full bg-violet-400/15 px-2 py-0.5 text-xs text-violet-200">{community.requests.length}</span></h2>{community.requests.length === 0 ? <p className="mt-3 text-xs text-zinc-500">You&apos;re all caught up.</p> : <div className="mt-3 space-y-3">{community.requests.map((user) => <div key={user.id} className="flex items-center gap-2"><Avatar user={user} size={30} /><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{user.name}</p><p className="text-[10px] text-zinc-500">@{user.handle}</p></div><button onClick={() => void action({ action: "review", userId: user.id, decision: "accept" })} className="rounded-md bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold text-emerald-300">Accept</button><button onClick={() => void action({ action: "review", userId: user.id, decision: "decline" })} className="rounded-md bg-rose-500/10 px-2 py-1 text-[10px] font-semibold text-rose-300">Decline</button></div>)}</div>}</section>}
          <section className="rounded-2xl border border-white/[.08] bg-zinc-900/65 p-4"><h2 className="mb-3 flex items-center gap-2 font-semibold"><Users size={16} className="text-cyan-300" />People <span className="ml-auto text-xs text-zinc-500">{community.memberCount}</span></h2><div className="space-y-3">{community.members.map((member) => <div key={member.id} className="flex items-center gap-2"><Avatar user={member} size={30} /><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{member.name}</p><p className="text-[10px] capitalize text-zinc-500">{member.role}</p></div>{isAdmin && member.role !== "admin" && <select aria-label={`Role for ${member.name}`} value={member.role} onChange={(e) => void action({ action: "role", userId: member.id, role: e.target.value })} className="rounded-md border border-white/10 bg-zinc-950 px-1.5 py-1 text-[10px] text-zinc-300"><option value="member">Member</option><option value="moderator">Mod</option></select>}</div>)}</div></section>
          <Link href="/explore" className="block rounded-2xl border border-white/[.08] bg-zinc-900/50 p-4 text-xs text-zinc-400 transition hover:border-violet-400/30">Discover more communities <span className="float-right text-violet-300">Explore →</span></Link>
        </aside>
      </div>
    </main>
  );
}
