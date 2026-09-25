"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  CalendarPlus,
  Eye,
  Heart,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Repeat2,
  Share2,
  Flag,
} from "lucide-react";
import { api, post as apiPost, type FeedPost } from "@/lib/client";
import { eventDateLabel, eventCountdown, parseContent, timeAgo } from "@/lib/utils";
import { useSession, useUI } from "@/components/providers";
import { Avatar, Chip, PulseBadge } from "@/components/ui/primitives";
import { REPORT_REASONS } from "@/lib/schema";

function RichText({ text }: { text: string }) {
  return (
    <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink/95">
      {parseContent(text).map((part, i) =>
        part.type === "mention" ? (
          <span key={i} className="text-ice">{part.value}</span>
        ) : part.type === "tag" ? (
          <span key={i} className="font-medium text-gold">{part.value}</span>
        ) : (
          <span key={i}>{part.value}</span>
        )
      )}
    </p>
  );
}

function MediaArt({ label, blur = false }: { label: string; blur?: boolean }) {
  const [revealed, setRevealed] = useState(false);
  const hidden = blur && !revealed;
  return (
    <div
      className={`relative mt-3 overflow-hidden rounded-2xl border border-edge ${hidden ? "cursor-pointer" : ""}`}
      onClick={() => hidden && setRevealed(true)}
    >
      <div
        className="h-56 w-full"
        style={{
          background: "linear-gradient(135deg, #3f3f46, #27272a, #09090b)",
          filter: hidden ? "blur(22px) saturate(0.6)" : undefined,
          transform: hidden ? "scale(1.15)" : undefined,
          transition: "filter 300ms ease, transform 300ms ease",
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/70 via-transparent to-transparent" />
      <div className="absolute bottom-3 left-4 text-xs font-medium text-white/80">{label}</div>
      {hidden && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-canvas/45">
          <Eye size={18} className="text-ink" />
          <p className="text-xs font-medium text-ink">Sensitive content — tap to view</p>
        </div>
      )}
    </div>
  );
}

function EventMetaCard({ post, onChange }: { post: FeedPost; onChange: (p: FeedPost) => void }) {
  const { toast } = useUI();
  const { me } = useSession();
  const ev = post.event!;
  const saved = post.savedByMe;
  const attendees = ev.attendeeIds ?? [];
  const attending = Boolean(me && attendees.includes(me.id));
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-3 rounded-2xl border border-gold/25 bg-gold-soft/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-display flex items-center gap-2 text-sm font-bold text-gold"><CalendarPlus size={15} /> {ev.title}{ev.category && <span className="rounded-full border border-gold/20 px-2 py-0.5 text-[10px] font-medium">{ev.category}</span>}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mist">
            <span>{eventDateLabel(ev.date)}</span><span className="text-gold/80">{eventCountdown(ev.date)}</span>
            <span className="flex items-center gap-1"><MapPin size={11} /> {ev.location}</span>
            {ev.durationMinutes && <span>{ev.durationMinutes >= 60 ? `${ev.durationMinutes / 60}h` : `${ev.durationMinutes}m`}</span>}
            <span>{attendees.length}{ev.capacity ? ` / ${ev.capacity}` : ""} attending</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          <button disabled={busy} onClick={async () => {
            setBusy(true);
            try { const { post: updated } = await apiPost<{ post: FeedPost }>(`/api/posts/${post.id}`, { action: "rsvp" }); onChange(updated); }
            catch (e) { toast(e instanceof Error ? e.message : "Couldn't update RSVP"); }
            finally { setBusy(false); }
          }} className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${attending ? "border border-ice/30 bg-ice/10 text-ice" : "bg-gradient-to-r from-gold to-amber-500 text-canvas hover:brightness-110"}`}>
            {busy ? "Saving..." : attending ? "Interested" : "RSVP / Interested"}
          </button>
          <button onClick={async () => {
            try { const { post: updated } = await apiPost<{ post: FeedPost }>(`/api/posts/${post.id}`, { action: "save" }); onChange(updated); toast(updated.savedByMe ? "Saved to Calendar" : "Removed from Calendar"); }
            catch (e) { toast(e instanceof Error ? e.message : "Failed"); }
          }} className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${saved ? "glass-pill text-gold" : "border border-white/10 text-zinc-300 hover:border-gold/40 hover:text-gold"}`}>
            {saved ? "Saved" : "Add to calendar"}
          </button>
        </div>
      </div>
      {ev.posterUrl && <img src={ev.posterUrl} alt={`${ev.title} poster`} className="mt-3 max-h-64 w-full rounded-xl object-cover" />}
    </div>
  );
}
function MediaGrid({ urls }: { urls: string[] }) {
  if (!urls.length) return null;
  return (
    <div className={`mt-3 grid gap-1.5 overflow-hidden rounded-2xl ${urls.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
      {urls.map((url, index) => {
        const isVideo = /\.(mp4|webm|mov)(\?.*)?$/i.test(url) || url.startsWith("data:video/");
        const isImage = /\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(url) || url.startsWith("data:image/");
        if (isVideo) return <video key={`${url}-${index}`} src={url} controls className="max-h-96 w-full rounded-xl object-cover" />;
        if (isImage) return <img key={`${url}-${index}`} src={url} alt="Post media" className="max-h-96 w-full rounded-xl object-cover" />;
        if (/\.gif$/i.test(url) && !/^https?:/i.test(url)) return <div key={`${url}-${index}`} className="grid aspect-video place-items-center rounded-xl border border-zinc-700/80 bg-zinc-800/80 text-3xl light:border-zinc-200 light:bg-zinc-100" role="img" aria-label="GIF attachment">🎞</div>;
        return /^https?:|^data:/i.test(url) ? <a key={`${url}-${index}`} href={url} download={!/^https?:/i.test(url)} target="_blank" rel="noreferrer" className="rounded-xl border border-edge bg-surface/70 px-4 py-3 text-sm text-ice underline">Open attachment {index + 1}</a>
          : <span key={`${url}-${index}`} className="rounded-xl border border-edge bg-surface/70 px-4 py-3 text-sm text-mist">{url}</span>;
      })}
    </div>
  );
}

function PollCard({ post, onChange }: { post: FeedPost; onChange: (p: FeedPost) => void }) {
  const { me } = useSession();
  const { toast } = useUI();
  const poll = post.poll!;
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const voterIds = [...new Set(poll.options.flatMap((option) => option.votes))];
  const hasVoted = Boolean(me && voterIds.includes(me.id));
  const expiresAt = poll.duration === "0" ? null : new Date(new Date(post.createdAt).getTime() + Number(poll.duration) * 86400000);
  const pollEnded = Boolean(expiresAt && expiresAt.getTime() <= Date.now());
  const showResults = !poll.hideResults || hasVoted || pollEnded;
  const vote = async (optionIds: string[]) => {
    if (!optionIds.length || busy) return;
    setBusy(true);
    try {
      const { post: updated } = await apiPost<{ post: FeedPost }>(`/api/posts/${post.id}`, { action: "vote", optionIds });
      onChange(updated);
      setSelected([]);
    } catch (e) { toast(e instanceof Error ? e.message : "Couldn't submit vote"); }
    finally { setBusy(false); }
  };
  return (
    <div className="mt-3 rounded-2xl border border-zinc-700/80 bg-zinc-900/50 p-4 light:border-zinc-200/80 light:bg-zinc-50/80">
      <h3 className="mb-3 font-semibold text-ink">{poll.question}</h3>
      <div className="space-y-2">
        {poll.options.map((option) => {
          const count = option.votes.length;
          const pct = poll.totalVotes ? Math.round((count / poll.totalVotes) * 100) : 0;
          const chosen = selected.includes(option.id);
          const myVote = Boolean(me && option.votes.includes(me.id));
          return (
            <button key={option.id} disabled={hasVoted || busy} onClick={() => poll.multipleChoice ? setSelected((v) => chosen ? v.filter((id) => id !== option.id) : [...v, option.id]) : void vote([option.id])} className={`relative w-full overflow-hidden rounded-xl border px-3 py-2.5 text-left text-sm ${chosen || myVote ? "border-violet-400/60" : "border-edge"}`}>
              {showResults && <motion.span initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.45 }} className="absolute inset-y-0 left-0 bg-zinc-500/20" />}
              <span className="relative flex items-center justify-between gap-3"><span>{option.text}</span><span className="shrink-0 text-xs text-mist">{showResults ? `${pct}% · ${count}` : "Vote"}</span></span>
            </button>
          );
        })}
      </div>
      {poll.multipleChoice && !hasVoted && <button disabled={!selected.length || busy} onClick={() => void vote(selected)} className="mt-3 rounded-full bg-zinc-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40 light:bg-zinc-900">{busy ? "Voting..." : "Submit vote"}</button>}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mist">
        <span>{poll.totalVotes} vote{poll.totalVotes === 1 ? "" : "s"}</span>
        <span>{poll.duration === "0" ? "No expiration" : `Ends in ${poll.duration} day${poll.duration === "1" ? "" : "s"}`}</span>
        {hasVoted && <span className="rounded-full border border-ice/20 bg-ice/10 px-2 py-1 text-ice">Voted by @{me?.handle} and {Math.max(0, voterIds.length - 1)} others</span>}
      </div>
    </div>
  );
}

function CommentBox({ post, onAdded }: { post: FeedPost; onAdded: (p: FeedPost) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const { post: updated } = await apiPost<{ post: FeedPost }>(`/api/posts/${post.id}`, { action: "comment", text: text.trim() });
      onAdded(updated);
      setText("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 space-y-2 border-t border-edge pt-3">
      {post.comments.map((c) => {
        const commenterHandle = c.authorId.replace("u_", "").toLowerCase();
        return (
          <div key={c.id} className="flex gap-2 text-sm">
            {/* Commenter avatar + name → their profile. */}
            <Link
              href={`/profile/${encodeURIComponent(commenterHandle)}`}
              onClick={(e) => e.stopPropagation()}
              className="mt-0.5 shrink-0"
              aria-label={`Open ${commenterHandle}'s profile`}
            >
              <Avatar user={{ id: c.authorId, name: c.authorId }} size={22} />
            </Link>
            <div>
              <Link
                href={`/profile/${encodeURIComponent(commenterHandle)}`}
                onClick={(e) => e.stopPropagation()}
                className="font-medium text-ink/90 hover:text-gold hover:underline"
              >
                {c.authorId.replace("u_", "")}
              </Link>{" "}
              <span className="text-ink/80">{c.text}</span>{" "}
              <span className="text-xs text-mist">{timeAgo(c.createdAt)}</span>
            </div>
          </div>
        );
      })}
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Add a comment…"
          className="flex-1 rounded-full border border-edge bg-surface/70 px-4 py-1.5 text-sm placeholder:text-mist/60"
        />
        <button onClick={send} disabled={busy || !text.trim()} className="rounded-full bg-ice/15 px-4 text-sm font-semibold text-ice disabled:opacity-40">
          Reply
        </button>
      </div>
    </div>
  );
}

export default function PostCard({ post, onChange, onOpenProfile }: { post: FeedPost; onChange: (p: FeedPost) => void; onOpenProfile?: (h: string) => void }) {
  const { me } = useSession();
  const { toast, openProfile } = useUI();
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportStep, setReportStep] = useState(false);
  const [reportDone, setReportDone] = useState(false);

  const author = post.author;
  const authorHref = `/profile/${encodeURIComponent(author.handle)}`;

  const act = async (action: "like" | "repost" | "save") => {
    try {
      const { post: updated } = await apiPost<{ post: FeedPost }>(`/api/posts/${post.id}`, { action });
      onChange(updated);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Action failed");
    }
  };

  const share = async () => {
    const url = `${window.location.origin}/profile/${author.handle}`;
    try {
      await navigator.clipboard.writeText(url);
      toast("Profile link copied");
    } catch {
      toast(url);
    }
  };

  const submitReport = async (reason: string) => {
    try {
      await api("/api/reports", { method: "POST", body: JSON.stringify({ targetType: "post", targetId: post.id, reason }) });
    } catch {
      /* silent for the reporter too */
    }
    setReportDone(true);
    setMenuOpen(false);
    setTimeout(() => setReportDone(false), 2400);
  };

  return (
    <article className="fade-up rounded-2xl border border-zinc-800/80 bg-zinc-900/80 p-5 text-zinc-100 backdrop-blur-md light:border-zinc-200/80 light:bg-white/80 light:text-zinc-900">
      <header className="flex items-start gap-3">
        {/* Avatar + name navigate to the author's profile; isolated from post actions. */}
        <Link
          href={authorHref}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Open ${author.name}'s profile`}
          className="shrink-0"
        >
          <Avatar user={author} size={44} ring={author.isSelf} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <Link
              href={authorHref}
              onClick={(e) => e.stopPropagation()}
              className="font-display font-semibold hover:text-gold"
            >
              {author.name}
            </Link>
            {post.type === "opportunity" && <PulseBadge label="Pulse" />}
            {post.type === "poll" && <PulseBadge label="Poll" />}
            <Chip tone={author.ageTag === "18+" ? "ice" : "gold"}>{author.ageTag}</Chip>
          </div>
          <p className="text-xs text-mist">
            <Link
              href={authorHref}
              onClick={(e) => e.stopPropagation()}
              className="font-mono hover:text-gold hover:underline"
            >
              @{author.handle}
            </Link>{" "}
            · {timeAgo(post.createdAt)}
            {post.type === "opportunity" && <span className="text-gold/80"> · Opportunity</span>}
          </p>
        </div>

        <div className="relative">
          <button onClick={() => setMenuOpen((v) => !v)} className="rounded-full p-1.5 text-mist hover:text-ink" aria-label="Post menu">
            <MoreHorizontal size={18} />
          </button>
          {menuOpen && (
            <div className="glass absolute right-0 top-8 z-20 w-52 p-1.5 text-sm">
              {author.isSelf ? (
                <span className="block px-3 py-2 text-mist">Your post</span>
              ) : reportStep ? (
                <>
                  <span className="block px-3 py-1.5 text-xs font-semibold text-mist">Select a reason</span>
                  {REPORT_REASONS.map((r) => (
                    <button key={r} onClick={() => submitReport(r)} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-card2">
                      {r}
                    </button>
                  ))}
                </>
              ) : (
                <button onClick={() => setReportStep(true)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-card2">
                  <Flag size={14} /> Report post
                </button>
              )}
            </div>
          )}
          {reportDone && <span className="absolute -bottom-6 right-0 whitespace-nowrap text-xs text-mist">Report submitted — thank you</span>}
        </div>
      </header>

      <div className="mt-3">
        {post.text && <RichText text={post.text} />}
        {post.media && <MediaArt label={post.media.label} blur={me?.settings.blurMedia ?? false} />}
        {post.mediaUrls && <MediaGrid urls={post.mediaUrls} />}
        {post.poll && <PollCard post={post} onChange={onChange} />}
        {post.event && <EventMetaCard post={post} onChange={onChange} />}
      </div>

      <footer className="mt-4 flex items-center gap-1 text-sm text-mist">
        <motion.button
          onClick={() => act("like")}
          whileTap={{ scale: 0.82, rotate: -8 }}
          whileHover={{ scale: 1.06 }}
          transition={{ type: "spring", stiffness: 500, damping: 18 }}
          aria-label={post.likedByMe ? "Unlike post" : "Like post"}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 transition hover:bg-coral/10 ${post.likedByMe ? "text-coral" : "hover:text-coral"}`}
        >
          <Heart size={16} className={post.likedByMe ? "fill-coral heart-pop" : ""} />
          {post.likes.length > 0 && <motion.span key={post.likes.length} initial={{ y: 5, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 500, damping: 24 }}>{post.likes.length}</motion.span>}
        </motion.button>
        <motion.button
          onClick={() => act("repost")}
          whileTap={{ scale: 0.82, rotate: 8 }}
          whileHover={{ scale: 1.06 }}
          transition={{ type: "spring", stiffness: 500, damping: 18 }}
          aria-label={post.repostedByMe ? "Undo repost" : "Repost"}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 transition hover:bg-ice/10 ${post.repostedByMe ? "text-ice" : "hover:text-ice"}`}
        >
          <Repeat2 size={16} />
          {post.reposts.length > 0 && <motion.span key={post.reposts.length} initial={{ y: 5, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 500, damping: 24 }}>{post.reposts.length}</motion.span>}
        </motion.button>
        <motion.button
          onClick={() => setCommentsOpen((v) => !v)}
          whileTap={{ scale: 0.82, y: 2 }}
          whileHover={{ scale: 1.06 }}
          transition={{ type: "spring", stiffness: 500, damping: 18 }}
          aria-label={commentsOpen ? "Close chat" : "Open chat"}
          title="Chat / comments"
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 transition hover:bg-ice/10 hover:text-ice"
        >
          <MessageCircle size={16} />
          {post.comments.length > 0 && post.comments.length}
        </motion.button>
        <motion.button
          onClick={share}
          whileTap={{ scale: 0.82, rotate: -8 }}
          whileHover={{ scale: 1.06 }}
          transition={{ type: "spring", stiffness: 500, damping: 18 }}
          aria-label="Share post"
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 transition hover:bg-gold/10 hover:text-gold"
        >
          <Share2 size={16} />
        </motion.button>
      </footer>

      {commentsOpen && <CommentBox post={post} onAdded={onChange} />}
    </article>
  );
}
