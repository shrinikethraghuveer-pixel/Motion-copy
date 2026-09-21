"use client";

import { useState } from "react";
import {
  Bookmark,
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

function MediaArt({ seed, label, blur = false }: { seed: string; label: string; blur?: boolean }) {
  const [revealed, setRevealed] = useState(false);
  const hidden = blur && !revealed;
  let a = 0;
  for (let i = 0; i < seed.length; i++) a = (a * 31 + seed.charCodeAt(i)) % 360;
  return (
    <div
      className={`relative mt-3 overflow-hidden rounded-2xl border border-edge ${hidden ? "cursor-pointer" : ""}`}
      onClick={() => hidden && setRevealed(true)}
    >
      <div
        className="h-56 w-full"
        style={{
          background: `linear-gradient(120deg, hsl(${a} 65% 42%), hsl(${(a + 80) % 360} 70% 30%), #0b1329)`,
          filter: hidden ? "blur(22px) saturate(0.6)" : undefined,
          transform: hidden ? "scale(1.15)" : undefined,
          transition: "filter 300ms ease, transform 300ms ease",
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-canvas/70 via-transparent to-transparent" />
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

function EventMetaCard({ post }: { post: FeedPost }) {
  const { toast } = useUI();
  const ev = post.event!;
  const saved = post.savedByMe;
  return (
    <div className="mt-3 rounded-2xl border border-gold/25 bg-gold-soft/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-display flex items-center gap-2 text-sm font-bold text-gold">
            <CalendarPlus size={15} /> {ev.title}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-mist">
            <span>{eventDateLabel(ev.date)}</span>
            <span className="text-gold/80">{eventCountdown(ev.date)}</span>
            <span className="flex items-center gap-1"><MapPin size={11} /> {ev.location}</span>
          </div>
        </div>
        <button
          onClick={async () => {
            try {
              const { post: updated } = await apiPost<{ post: FeedPost }>(`/api/posts/${post.id}`, { action: "save" });
              toast(updated.savedByMe ? "Saved to Calendar — see My Space" : "Removed from Calendar");
              window.dispatchEvent(new CustomEvent("motion:refresh"));
            } catch (e) {
              toast(e instanceof Error ? e.message : "Failed");
            }
          }}
          className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
            saved ? "glass-pill text-gold" : "bg-gradient-to-r from-gold to-amber-500 text-canvas hover:brightness-110"
          }`}
        >
          {saved ? "Saved ✓" : "Save to Calendar"}
        </button>
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
      {post.comments.map((c) => (
        <div key={c.id} className="flex gap-2 text-sm">
          <span className="mt-0.5"><Avatar user={{ id: c.authorId, name: c.authorId }} size={22} /></span>
          <div>
            <span className="font-medium text-ink/90">{c.authorId.replace("u_", "")}</span>{" "}
            <span className="text-ink/80">{c.text}</span>{" "}
            <span className="text-xs text-mist">{timeAgo(c.createdAt)}</span>
          </div>
        </div>
    ))}
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
  const [pop, setPop] = useState(false);
  const [reportStep, setReportStep] = useState(false);
  const [reportDone, setReportDone] = useState(false);

  const author = post.author;

  const act = async (action: "like" | "repost" | "save") => {
    if (action === "like") setPop(true);
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
    <article className="glass fade-up p-5">
      <header className="flex items-start gap-3">
        <button onClick={() => (onOpenProfile ? onOpenProfile(author.handle) : openProfile(author.handle))}>
          <Avatar user={author} size={44} ring={author.isSelf} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <button onClick={() => (onOpenProfile ? onOpenProfile(author.handle) : openProfile(author.handle))} className="font-display font-semibold hover:text-gold">
              {author.name}
            </button>
            {post.type === "opportunity" && <PulseBadge label="Pulse" />}
            <Chip tone={author.ageTag === "18+" ? "ice" : "gold"}>{author.ageTag}</Chip>
          </div>
          <p className="text-xs text-mist">
            @{author.handle} · {timeAgo(post.createdAt)}
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
        <RichText text={post.text} />
        {post.media && <MediaArt seed={post.media.seed} label={post.media.label} blur={me?.settings.blurMedia ?? false} />}
        {post.event && <EventMetaCard post={post} />}
      </div>

      <footer className="mt-4 flex items-center gap-1 text-sm text-mist">
        <button
          onClick={() => act("like")}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 transition hover:bg-coral/10 ${post.likedByMe ? "text-coral" : "hover:text-coral"}`}
        >
          <Heart size={16} className={post.likedByMe ? "fill-coral heart-pop" : ""} />
          {post.likes.length > 0 && post.likes.length}
        </button>
        <button onClick={() => setCommentsOpen((v) => !v)} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 transition hover:bg-ice/10 hover:text-ice">
          <MessageCircle size={16} />
          {post.comments.length > 0 && post.comments.length}
        </button>
        <button onClick={share} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 transition hover:bg-gold/10 hover:text-gold">
          <Share2 size={16} />
        </button>
        <button
          onClick={() => act("repost")}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 transition hover:bg-ice/10 ${post.repostedByMe ? "text-ice" : "hover:text-ice"}`}
        >
          <Repeat2 size={16} />
          {post.reposts.length > 0 && post.reposts.length}
        </button>
        <button
          onClick={() => act("save")}
          className={`ml-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 transition hover:bg-gold/10 ${post.savedByMe ? "text-gold" : "hover:text-gold"}`}
          title={post.event ? "Save to Calendar" : "Save post"}
        >
          <Bookmark size={16} className={post.savedByMe ? "fill-gold" : ""} />
        </button>
      </footer>

      {commentsOpen && <CommentBox post={post} onAdded={onChange} />}
    </article>
  );
}
