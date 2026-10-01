"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, BarChart3, CalendarDays, Check, Clock, Link2, Loader2, LockKeyhole, MapPin, MessageCircle, Paperclip, Pin, Search, Send, Shield, Smile, Sparkles, Users, Vote, X } from "lucide-react";
import { api, post as sendPost, type PublicUser } from "@/lib/client";
import { useSession, useUI } from "@/components/providers";
import { Avatar } from "@/components/ui/primitives";
import { timeAgo } from "@/lib/utils";
import { uploadPostMedia } from "@/lib/db/profiles";
import CreatePost, { type ComposerResult } from "@/components/motion/create-post";

type Member = PublicUser & { role: string };
type Reply = { id: string; text: string; createdAt: string; author: PublicUser };
type DiscussionPoll = {
  question: string;
  options: Array<{ id: string; text: string; votes: string[] }>;
  duration: string;
  multipleChoice: boolean;
  hideResults: boolean;
  totalVotes: number;
};
type DiscussionEvent = {
  title: string;
  date: string;
  location: string;
  kind: "internship" | "hackathon" | "event";
  endTime?: string;
  durationMinutes?: number;
  capacity?: number | null;
  category?: string;
  attendeeIds?: string[];
  posterUrl?: string | null;
  link?: string;
};
type Discussion = {
  id: string; text: string; createdAt: string; pinned: boolean; author: PublicUser; replies: Reply[];
  mediaUrls?: string[] | null; poll?: DiscussionPoll | null; event?: DiscussionEvent | null;
};
type CommunityDetail = {
  id: string; name: string; tag: string; tags: string[]; description: string; visibility: "public" | "private";
  avatarUrl: string | null; memberCount: number; myRole: string | null; myRequestStatus: "member" | "pending" | "none"; members: Member[];
  requests: Array<PublicUser & { requestedAt: string }>; posts: Discussion[];
};

type PostKind = "standard" | "event" | "poll";
type CommunityAudience = "Everyone" | "Community Only" | "Members Only";

const EVENT_KINDS = ["Hackathon", "Workshop", "Gaming", "Casual", "Study Group", "Sports"] as const;
const POLL_DURATIONS = [
  { value: "1", label: "1 day" },
  { value: "3", label: "3 days" },
  { value: "7", label: "7 days" },
  { value: "0", label: "No expiration" },
] as const;
const COMMUNITY_AUDIENCES: CommunityAudience[] = ["Everyone", "Community Only", "Members Only"];
const COMMUNITY_GIFS = [
  { label: "excited", url: "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExM2Y5ZXRtM3Z1c3U4YTNuc3E0cDkwbWJ1b3A3ZTU3YXE4MGVzc2JkbmFoeSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/3o7abldj0b3rxrZUxW/giphy.gif" },
  { label: "ship-it", url: "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExM2Y5ZXRtM3Z1c3U4YTNuc3E0cDkwbWJ1b3A3ZTU3YXE4MGVzc2JkbmFoeSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/l0HlHFRbmaZtBRhXG/giphy.gif" },
  { label: "mind-blown", url: "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExM2Y5ZXRtM3Z1c3U4YTNuc3E0cDkwbWJ1b3A3ZTU3YXE4MGVzc2JkbmFoeSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/ToMjGpKniGqRNLGBrhu/giphy.gif" },
  { label: "applause", url: "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExM2Y5ZXRtM3Z1c3U4YTNuc3E0cDkwbWJ1b3A3ZTU3YXE4MGVzc2JkbmFoeSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/l3q2XhfQ8oCkm1Ts4/giphy.gif" },
];
const COMMUNITY_EMOJIS = ["😀", "😂", "🥹", "😍", "🤩", "😎", "🤔", "🙌", "👏", "👍", "🔥", "💜", "✨", "⚡", "🚀", "📚", "🎓", "💻"];

export default function CommunityPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useUI();
  const { me } = useSession();
  const [community, setCommunity] = useState<CommunityDetail | null>(null);
  const [message, setMessage] = useState("");
  const [audience, setAudience] = useState<CommunityAudience>("Community Only");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // ── Composer state (Home-page parity) ──────────────────────────
  const [postKind, setPostKind] = useState<PostKind>("standard");
  const [eventDraft, setEventDraft] = useState({ title: "", date: "", time: "", endTime: "", duration: "60", venue: "", link: "", capacity: "", category: "Casual" });
  const [pollDraft, setPollDraft] = useState<{ question: string; options: string[]; duration: "1" | "3" | "7" | "0"; multipleChoice: boolean; hideResults: boolean }>({ question: "", options: ["", ""], duration: "1", multipleChoice: false, hideResults: false });
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const [composerBusy, setComposerBusy] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [gifQuery, setGifQuery] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [sharpening, setSharpening] = useState(false);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const [votedPolls, setVotedPolls] = useState<Record<string, string[]>>({});

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

  const canSubmit =
    (postKind === "standard" && (message.trim().length > 0 || mediaUrls.length > 0)) ||
    (postKind === "event" && eventDraft.title.trim() && eventDraft.date && eventDraft.time && eventDraft.venue.trim()) ||
    (postKind === "poll" && pollDraft.question.trim() && pollDraft.options.filter((option) => option.trim()).length >= 2);

  const attachMedia = async (files: FileList | null) => {
    if (!files?.length || uploadingMedia) return;
    const selected = [...files].slice(0, Math.max(0, 4 - mediaUrls.length));
    if (selected.length === 0) { toast("You can attach up to four files."); return; }
    setUploadingMedia(true);
    try {
      const urls = await Promise.all(selected.map(uploadPostMedia));
      setMediaUrls((current) => [...current, ...urls].slice(0, 4));
      toast(`${urls.length} attachment${urls.length > 1 ? "s" : ""} added`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setUploadingMedia(false);
    }
  };

  const resetComposer = () => {
    setPostKind("standard");
    setMessage("");
    setMediaUrls([]);
    setGifUrl(null);
    setAudience("Community Only");
    setEventDraft({ title: "", date: "", time: "", endTime: "", duration: "60", venue: "", link: "", capacity: "", category: "Casual" });
    setPollDraft({ question: "", options: ["", ""], duration: "1", multipleChoice: false, hideResults: false });
  };

  const insertEmoji = (emoji: string) => {
    const input = messageRef.current;
    if (!input) { setMessage((current) => current + emoji); return; }
    const start = input.selectionStart ?? message.length;
    const end = input.selectionEnd ?? message.length;
    setMessage(message.slice(0, start) + emoji + message.slice(end));
    requestAnimationFrame(() => { input.focus(); input.selectionStart = input.selectionEnd = start + emoji.length; });
  };

  const addGif = (url: string) => {
    setGifUrl(url);
    setMediaUrls((current) => [...current, url].slice(0, 4));
    setGifOpen(false);
  };

  const sharpenDraft = async () => {
    const draft = message.trim();
    if (!draft || sharpening) return;
    setSharpening(true);
    try {
      const response = await fetch("/api/ai/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: `Rewrite this community post so it is sharper and more engaging. Keep its voice and key details. Reply only with the rewritten post.\n\nPost: ${draft}` }) });
      if (!response.headers.get("content-type")?.includes("text/event-stream") || !response.body) throw new Error("AI enhancement is unavailable right now.");
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; let improved = "";
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true }); const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
        for (const line of lines) { if (!line.trim().startsWith("data:")) continue; const data = line.trim().slice(5).trim(); if (data === "[DONE]") break; try { const token = JSON.parse(data).token; if (typeof token === "string") improved += token; } catch { /* ignore malformed stream chunks */ } }
      }
      if (improved.trim()) { setMessage(improved.trim().slice(0, 2000)); toast("Draft enhanced with AI"); }
    } catch (error) { toast(error instanceof Error ? error.message : "AI enhancement failed."); }
    finally { setSharpening(false); }
  };

  const submitPost = async (formEvent: React.FormEvent) => {
    formEvent.preventDefault();
    if (!canSubmit || composerBusy) return;
    setComposerBusy(true);
    const pollData = postKind === "poll" ? { ...pollDraft, options: pollDraft.options.filter((option) => option.trim()) } : undefined;
    const payload: Record<string, unknown> = {
      action: "post", group_id: id, content: message.trim(), audience_scope: audience,
      media_urls: mediaUrls, gif_url: gifUrl, poll_data: pollData, text: message.trim(), type: postKind,
      audience, mediaUrls,
    };
    if (postKind === "event") {
      payload.event = {
        title: eventDraft.title.trim(),
        date: new Date(`${eventDraft.date}T${eventDraft.time}`).toISOString(),
        location: eventDraft.venue.trim(),
        kind: eventDraft.category.toLowerCase() === "hackathon" ? "hackathon" : "event",
        endTime: eventDraft.endTime || undefined,
        durationMinutes: Number(eventDraft.duration) || undefined,
        capacity: eventDraft.capacity ? Number(eventDraft.capacity) : null,
        category: eventDraft.category,
        attendeeIds: [],
        posterUrl: mediaUrls[0] ?? null,
        link: eventDraft.link.trim() || undefined,
      };
    }
    if (postKind === "event") payload.event_data = payload.event;
    if (pollData) payload.poll = pollData;
    setBusy(true);
    try {
      await sendPost(`/api/groups/${id}`, payload);
      resetComposer();
      await load();
      toast(postKind === "event" ? "Event shared with the community ⚡" : postKind === "poll" ? "Poll posted 🗳" : "Posted to the community");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not post.");
    } finally {
      setComposerBusy(false);
      setBusy(false);
    }
  };

  const submitCommunityComposer = async (draft: ComposerResult) => {
    if (composerBusy) return;
    setComposerBusy(true);
    const event = draft.event ? {
      title: draft.event.title.trim(),
      date: new Date(`${draft.event.date}T${draft.event.time}`).toISOString(),
      location: draft.event.venue.trim(),
      kind: draft.event.category.toLowerCase() === "hackathon" ? "hackathon" : "event",
      endTime: draft.event.endTime || undefined,
      durationMinutes: Number(draft.event.duration) || undefined,
      capacity: draft.event.capacity ? Number(draft.event.capacity) : null,
      category: draft.event.category,
      attendeeIds: [],
      posterUrl: draft.media[0] ?? null,
    } : undefined;
    try {
      await sendPost(`/api/groups/${id}`, {
        action: "post", group_id: community?.id, content: draft.text, audience_scope: draft.audience,
        media_urls: draft.media, gif_url: draft.media.find((url) => /\.gif(?:\?.*)?$/i.test(url)) ?? null,
        poll_data: draft.poll ? { ...draft.poll, multipleChoice: draft.poll.votesPerUser === 99 } : undefined,
        event_data: event, type: draft.kind,
      });
      await load();
      toast(draft.kind === "event" ? "Event shared with the community" : draft.kind === "poll" ? "Poll posted" : "Posted to the community");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not post.");
    } finally {
      setComposerBusy(false);
    }
  };

  const votePoll = async (discussion: Discussion, optionIds: string[]) => {
    const poll = discussion.poll;
    if (!poll) return;
    setBusy(true);
    try {
      await sendPost(`/api/groups/${id}`, { action: "vote", postId: discussion.id, options: optionIds });
      setVotedPolls((current) => ({ ...current, [discussion.id]: optionIds }));
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Vote failed.");
    } finally {
      setBusy(false);
    }
  };

  const rsvpEvent = async (discussion: Discussion) => {
    const event = discussion.event;
    if (!event) return;
    setBusy(true);
    try {
      await sendPost(`/api/groups/${id}`, { action: "rsvp", postId: discussion.id });
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : "RSVP failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!community) return <main className="mx-auto min-h-[70vh] max-w-5xl animate-pulse p-6"><div className="h-48 rounded-3xl bg-zinc-900" /></main>;
  const isMember = Boolean(community.myRole);
  const canModerate = community.myRole === "admin" || community.myRole === "moderator";
  const isAdmin = community.myRole === "admin";
  const modeChip = postKind === "poll" ? "Poll mode" : postKind === "event" ? "Event mode" : null;

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

          {isMember && (
            <>
              <div className="mb-4">
                <CreatePost groupId={community.id} onPost={(draft) => void submitCommunityComposer(draft)} defaultAudience="Community Only" audienceOptions={COMMUNITY_AUDIENCES} />
              </div>
              {false && <form onSubmit={submitPost} className="mb-4 rounded-2xl border border-violet-400/20 bg-zinc-900/75 p-4 shadow-[0_8px_40px_rgba(109,40,217,.08)]">
              {/* Post-type switcher — Standard / Event / Poll */}
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex gap-1.5">
                  {([["standard", <MessageCircle key="i" size={13} />, "Standard"], ["event", <CalendarDays key="i" size={13} />, "Event"], ["poll", <BarChart3 key="i" size={13} />, "Poll"]] as const).map(([value, icon, label]) => (
                    <button key={value} type="button" onClick={() => setPostKind(value)} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${postKind === value ? "border-violet-500/50 bg-violet-500/15 text-violet-300" : "border-white/10 text-zinc-400 hover:text-zinc-200"}`}>{icon}{label}</button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  {modeChip && <span key={postKind} className="composer-swap hidden items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-[11px] font-semibold text-violet-300 sm:inline-flex">{modeChip}</span>}
                  <label className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-[11px] font-medium text-zinc-300 light:border-zinc-200 light:bg-zinc-100 light:text-zinc-700"><Users size={12} className="text-violet-400" /><select value={audience} onChange={(event) => setAudience(event.target.value as CommunityAudience)} aria-label="Post audience" className="cursor-pointer appearance-none bg-transparent text-[11px] font-medium outline-none [&>option]:bg-zinc-900">{COMMUNITY_AUDIENCES.map((option) => <option key={option}>{option}</option>)}</select></label>
                </div>
              </div>

              <textarea ref={messageRef} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} rows={postKind === "standard" ? 3 : 2} placeholder={postKind === "standard" ? "Share an update, question, or idea with the community…" : postKind === "event" ? "Add a caption for your event (optional)…" : "Add context for your poll (optional)…"} className="w-full resize-none bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500 light:text-zinc-900" />

              {/* Event details */}
              {postKind === "event" && (
                <div className="mt-1 space-y-2.5 rounded-xl border border-violet-500/25 bg-violet-500/[.06] p-3">
                  <input value={eventDraft.title} onChange={(e) => setEventDraft({ ...eventDraft, title: e.target.value })} placeholder="Event title — e.g. Late-night build session" className="w-full bg-transparent text-sm font-semibold outline-none placeholder:text-zinc-500" />
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <label className="rounded-lg border border-white/10 bg-zinc-900/50 px-2.5 py-1.5"><span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Date</span><input type="date" value={eventDraft.date} onChange={(e) => setEventDraft({ ...eventDraft, date: e.target.value })} className="w-full bg-transparent text-xs [color-scheme:dark] outline-none" /></label>
                    <label className="rounded-lg border border-white/10 bg-zinc-900/50 px-2.5 py-1.5"><span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Starts</span><input type="time" value={eventDraft.time} onChange={(e) => setEventDraft({ ...eventDraft, time: e.target.value })} className="w-full bg-transparent text-xs [color-scheme:dark] outline-none" /></label>
                    <label className="rounded-lg border border-white/10 bg-zinc-900/50 px-2.5 py-1.5"><span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Ends</span><input type="time" value={eventDraft.endTime} onChange={(e) => setEventDraft({ ...eventDraft, endTime: e.target.value })} className="w-full bg-transparent text-xs [color-scheme:dark] outline-none" /></label>
                    <label className="rounded-lg border border-white/10 bg-zinc-900/50 px-2.5 py-1.5"><span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Duration</span><select value={eventDraft.duration} onChange={(e) => setEventDraft({ ...eventDraft, duration: e.target.value })} className="w-full cursor-pointer appearance-none bg-transparent text-xs outline-none [&>option]:bg-zinc-900"><option value="30">30 min</option><option value="60">1 hour</option><option value="90">1.5 hours</option><option value="120">2 hours</option><option value="180">3 hours</option></select></label>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input value={eventDraft.venue} onChange={(e) => setEventDraft({ ...eventDraft, venue: e.target.value })} placeholder="Location — Google Meet / Campus Quad / Room 402" className="h-9 rounded-lg border border-white/10 bg-zinc-900/50 px-3 text-xs outline-none placeholder:text-zinc-500 focus:border-violet-500/50" />
                    <input value={eventDraft.link} onChange={(e) => setEventDraft({ ...eventDraft, link: e.target.value })} placeholder="Event link (optional)" className="h-9 rounded-lg border border-white/10 bg-zinc-900/50 px-3 text-xs outline-none placeholder:text-zinc-500 focus:border-violet-500/50" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="rounded-lg border border-white/10 bg-zinc-900/50 px-2.5 py-1.5"><span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Capacity</span><input type="number" min={2} placeholder="Unlimited" value={eventDraft.capacity} onChange={(e) => setEventDraft({ ...eventDraft, capacity: e.target.value })} className="w-full bg-transparent text-xs outline-none placeholder:text-zinc-600" /></label>
                    <label className="rounded-lg border border-white/10 bg-zinc-900/50 px-2.5 py-1.5"><span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Category</span><select value={eventDraft.category} onChange={(e) => setEventDraft({ ...eventDraft, category: e.target.value })} className="w-full cursor-pointer appearance-none bg-transparent text-xs outline-none [&>option]:bg-zinc-900">{EVENT_KINDS.map((category) => <option key={category}>{category}</option>)}</select></label>
                  </div>
                </div>
              )}

              {/* Poll details */}
              {postKind === "poll" && (
                <div className="mt-1 space-y-2.5 rounded-xl border border-violet-500/25 bg-violet-500/[.06] p-3">
                  <input value={pollDraft.question} onChange={(e) => setPollDraft({ ...pollDraft, question: e.target.value })} placeholder="Ask the community a question…" className="w-full bg-transparent text-sm font-semibold outline-none placeholder:text-zinc-500" />
                  <div className="space-y-2">
                    {pollDraft.options.map((option, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <span className="grid size-6 shrink-0 place-items-center rounded-full border border-white/10 bg-zinc-900/60 text-[10px] font-bold text-violet-300">{String.fromCharCode(65 + index)}</span>
                        <input value={option} onChange={(e) => { const options = [...pollDraft.options]; options[index] = e.target.value; setPollDraft({ ...pollDraft, options }); }} placeholder={`Option ${index + 1}`} className="h-9 flex-1 rounded-lg border border-white/10 bg-zinc-900/50 px-3 text-xs outline-none placeholder:text-zinc-500 focus:border-violet-500/50" />
                        {pollDraft.options.length > 2 && <button type="button" onClick={() => setPollDraft({ ...pollDraft, options: pollDraft.options.filter((_, j) => j !== index) })} className="text-zinc-600 transition hover:text-rose-400" aria-label={`Remove option ${index + 1}`}><X size={14} /></button>}
                      </div>
                    ))}
                    {pollDraft.options.length < 6 && <button type="button" onClick={() => setPollDraft({ ...pollDraft, options: [...pollDraft.options, ""] })} className="text-xs font-semibold text-violet-400 transition hover:text-violet-300">+ Add option</button>}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="rounded-lg border border-white/10 bg-zinc-900/50 px-2.5 py-1.5"><span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Duration</span><select value={pollDraft.duration} onChange={(e) => setPollDraft({ ...pollDraft, duration: e.target.value as "1" | "3" | "7" | "0" })} className="w-full cursor-pointer appearance-none bg-transparent text-xs outline-none [&>option]:bg-zinc-900">{POLL_DURATIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}</select></label>
                    <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-zinc-900/50 px-2.5 py-1.5">
                      <button type="button" onClick={() => setPollDraft({ ...pollDraft, multipleChoice: !pollDraft.multipleChoice })} className={`rounded-full px-2 py-1 text-[10px] font-semibold transition ${pollDraft.multipleChoice ? "bg-violet-500/20 text-violet-300" : "text-zinc-500 hover:text-zinc-300"}`}>Multiple choice</button>
                      <button type="button" onClick={() => setPollDraft({ ...pollDraft, hideResults: !pollDraft.hideResults })} className={`rounded-full px-2 py-1 text-[10px] font-semibold transition ${pollDraft.hideResults ? "bg-violet-500/20 text-violet-300" : "text-zinc-500 hover:text-zinc-300"}`}>{pollDraft.hideResults ? "Hidden until end" : "Live results"}</button>
                    </div>
                  </div>
                </div>
              )}

              {/* Media previews */}
              {mediaUrls.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {mediaUrls.map((url, index) => (
                    <span key={`${url}-${index}`} className="relative flex h-20 max-w-44 items-center gap-1.5 overflow-hidden rounded-lg border border-white/10 bg-zinc-900/60 px-2 py-1 text-[11px] text-zinc-300">
                      {/^data:image\//.test(url) || /\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(url) ? <img src={url} alt="Attachment preview" className="h-full max-w-32 rounded object-cover" /> : <span className="max-w-32 truncate">{url.split("/").pop()}</span>}
                      <button type="button" onClick={() => setMediaUrls((current) => current.filter((_, j) => j !== index))} className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-zinc-950/80 text-zinc-400 transition hover:text-rose-400" aria-label={`Remove attachment ${index + 1}`}><X size={12} /></button>
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-3 flex items-center justify-between border-t border-zinc-800 pt-3 light:border-zinc-200">
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => mediaInputRef.current?.click()} disabled={uploadingMedia} className="rounded-full p-2 text-zinc-500 transition hover:bg-white/5 hover:text-violet-300 disabled:opacity-40" aria-label="Attach file">{uploadingMedia ? <Loader2 size={17} className="animate-spin" /> : <Paperclip size={17} />}</button>
                  <input ref={mediaInputRef} type="file" multiple accept="image/*,video/*,.pdf,.doc,.docx,.txt" className="hidden" onChange={(e) => { void attachMedia(e.target.files); e.target.value = ""; }} />
                  <div className="relative"><button type="button" onClick={() => { setGifOpen((open) => !open); setEmojiOpen(false); }} className={`rounded-full px-2 py-2 text-[10px] font-black tracking-tight transition hover:bg-white/5 hover:text-violet-300 ${gifOpen ? "bg-violet-500/15 text-violet-300" : "text-zinc-500"}`} aria-label="Add GIF">GIF</button>{gifOpen && <div className="absolute bottom-11 left-0 z-30 w-64 rounded-xl border border-zinc-800 bg-zinc-900/95 p-3 shadow-2xl backdrop-blur-xl light:border-zinc-200 light:bg-white/95"><div className="mb-2 flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950/50 px-2 py-1.5 light:border-zinc-200 light:bg-zinc-100"><Search size={12} className="text-zinc-500" /><input value={gifQuery} onChange={(event) => setGifQuery(event.target.value)} placeholder="Search GIFs" className="w-full bg-transparent text-xs text-zinc-200 outline-none placeholder:text-zinc-500 light:text-zinc-800" /></div><div className="grid grid-cols-3 gap-1.5">{COMMUNITY_GIFS.filter((gif) => gif.label.includes(gifQuery.toLowerCase())).map((gif) => <button key={gif.label} type="button" onClick={() => addGif(gif.url)} className="rounded-lg bg-violet-500/10 px-1 py-3 text-[10px] font-semibold text-violet-200 transition hover:bg-violet-600 hover:text-white">{gif.label}</button>)}</div></div>}</div>
                  <div className="relative"><button type="button" onClick={() => { setEmojiOpen((open) => !open); setGifOpen(false); }} className={`rounded-full p-2 transition hover:bg-white/5 hover:text-violet-300 ${emojiOpen ? "bg-violet-500/15 text-violet-300" : "text-zinc-500"}`} aria-label="Add emoji"><Smile size={17} /></button>{emojiOpen && <div className="absolute bottom-11 left-0 z-30 grid w-60 grid-cols-6 gap-1 rounded-xl border border-zinc-800 bg-zinc-900/95 p-2 shadow-2xl backdrop-blur-xl light:border-zinc-200 light:bg-white/95">{COMMUNITY_EMOJIS.map((emoji) => <button key={emoji} type="button" onClick={() => insertEmoji(emoji)} className="grid size-8 place-items-center rounded-md text-base transition hover:scale-110 hover:bg-violet-500/15">{emoji}</button>)}</div>}</div>
                  <button type="button" onClick={() => setPostKind(postKind === "poll" ? "standard" : "poll")} className={`rounded-full p-2 transition hover:bg-white/5 hover:text-violet-300 ${postKind === "poll" ? "bg-violet-500/15 text-violet-300" : "text-zinc-500"}`} aria-label="Toggle poll mode"><BarChart3 size={17} /></button>
                  <button type="button" onClick={() => setPostKind(postKind === "event" ? "standard" : "event")} className={`rounded-full p-2 transition hover:bg-white/5 hover:text-violet-300 ${postKind === "event" ? "bg-violet-500/15 text-violet-300" : "text-zinc-500"}`} aria-label="Toggle event mode"><CalendarDays size={17} /></button>
                  <button type="button" onClick={() => void sharpenDraft()} disabled={!message.trim() || sharpening} className="rounded-full p-2 text-zinc-500 transition hover:bg-white/5 hover:text-violet-300 disabled:opacity-40" aria-label="Enhance with AI">{sharpening ? <Loader2 size={17} className="animate-spin" /> : <Sparkles size={17} />}</button>
                  <span className="ml-1 hidden text-xs text-zinc-500 sm:inline">{message.length}/2000</span>
                </div>
                <button type="submit" disabled={!canSubmit || composerBusy || busy} className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold transition hover:bg-violet-500 disabled:opacity-40">{composerBusy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}{postKind === "event" ? "Share Event" : postKind === "poll" ? "Post Poll" : "Post"}</button>
              </div>
              </form>}
            </>
          )}
          {!isMember && <div className="mb-4 rounded-2xl border border-white/10 bg-zinc-900/60 p-5 text-sm text-zinc-400">Join this community to take part in discussions{community.visibility === "private" ? " and see member posts" : ""}.</div>}

          <div className="space-y-3">{community.posts.map((item) => <article key={item.id} className="rounded-2xl border border-white/[.08] bg-zinc-900/65 p-4 sm:p-5">
            {item.pinned && <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-violet-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-violet-300"><Pin size={11} />Pinned announcement</p>}
            <div className="flex gap-3"><Avatar user={item.author} size={38} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">{item.author.name}</span><span className="text-xs text-zinc-500">@{item.author.handle} · {timeAgo(item.createdAt)}</span></div><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">{item.text}</p>

              {/* Media */}
              {(item.mediaUrls?.length ?? 0) > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2">{item.mediaUrls!.map((url, index) => <div key={`${url}-${index}`} className="overflow-hidden rounded-xl border border-white/10">{/^data:image\//.test(url) || /\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(url) ? <img src={url} alt="Post attachment" className="max-h-64 w-full object-cover" /> : /^data:video\//.test(url) || /\.(mp4|webm|mov)(\?.*)?$/i.test(url) ? <video src={url} controls className="max-h-64 w-full" /> : <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-3 py-2.5 text-xs text-cyan-300 hover:underline"><Link2 size={13} /><span className="truncate">{url}</span></a>}</div>)}</div>}

              {/* Event card */}
              {item.event && (() => {
                const attendees = item.event!.attendeeIds ?? [];
                const going = me ? attendees.includes(me.id) : false;
                const capacity = item.event!.capacity ?? null;
                const isFull = capacity !== null && attendees.length >= capacity;
                return (
                  <div className="mt-3 overflow-hidden rounded-xl border border-violet-500/25 bg-violet-500/[.06]">
                    {item.event!.posterUrl && (/^data:image\//.test(item.event!.posterUrl) || /\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(item.event!.posterUrl)) && <img src={item.event!.posterUrl} alt="" className="h-36 w-full object-cover" />}
                    <div className="p-3.5">
                      <div className="flex items-center gap-2"><CalendarDays size={14} className="text-violet-300" /><p className="text-sm font-semibold text-violet-200">{item.event!.title}</p></div>
                      <div className="mt-2 space-y-1 text-xs text-zinc-400">
                        <p className="flex items-center gap-1.5"><Clock size={12} />{new Date(item.event!.date).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}{item.event!.durationMinutes ? ` · ${item.event!.durationMinutes} min` : ""}</p>
                        <p className="flex items-center gap-1.5"><MapPin size={12} />{item.event!.location}</p>
                        {capacity !== null && <p className="flex items-center gap-1.5"><Users size={12} />{attendees.length} going{capacity ? ` · ${capacity} spots` : ""}</p>}
                      </div>
                      {isMember && <button disabled={busy} onClick={() => void rsvpEvent(item)} className={`mt-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-40 ${going ? "border border-violet-500/40 bg-violet-500/15 text-violet-200" : "bg-violet-600 text-white hover:bg-violet-500"}`}><Check size={12} />{going ? "You're going" : isFull ? "Event full" : "I'm going"}</button>}
                    </div>
                  </div>
                );
              })()}

              {/* Poll card */}
              {item.poll && (() => {
                const poll = item.poll!;
                const mySelection = votedPolls[item.id] ?? [];
                const hasVoted = mySelection.length > 0 || (me ? poll.options.some((option) => option.votes.includes(me.id)) : false);
                const pollEnded = poll.duration !== "0" && Date.now() > new Date(new Date(item.createdAt).getTime() + Number(poll.duration) * 86400000).getTime();
                const showResults = !poll.hideResults || hasVoted || pollEnded;
                return (
                  <div className="mt-3 rounded-xl border border-white/10 bg-zinc-950/40 p-3.5">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Vote size={14} className="text-violet-300" />{poll.question}</h3>
                    <div className="space-y-2">
                      {poll.options.map((option) => {
                        const count = option.votes.length;
                        const pct = poll.totalVotes ? Math.round((count / poll.totalVotes) * 100) : 0;
                        const chosen = mySelection.includes(option.id);
                        return (
                          <button key={option.id} disabled={busy || hasVoted || pollEnded} onClick={() => void votePoll(item, poll.multipleChoice ? (chosen ? mySelection.filter((x) => x !== option.id) : [...mySelection, option.id]) : [option.id])} className={`relative w-full overflow-hidden rounded-xl border px-3 py-2.5 text-left text-sm transition disabled:cursor-default ${chosen ? "border-violet-400/60" : "border-white/10 hover:border-violet-400/40"}`}>
                            {showResults && <span className="absolute inset-y-0 left-0 bg-violet-500/15" style={{ width: `${pct}%` }} />}
                            <span className="relative flex items-center justify-between"><span className="text-zinc-200">{option.text}</span>{showResults && <span className="text-xs font-semibold text-violet-300">{pct}%</span>}</span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-3 flex items-center gap-3 text-[11px] text-zinc-500"><span>{poll.totalVotes} vote{poll.totalVotes === 1 ? "" : "s"}</span><span>{poll.duration === "0" ? "No expiration" : `Ends in ${poll.duration} day${poll.duration === "1" ? "" : "s"}`}</span>{poll.multipleChoice && <span className="text-violet-300/80">Multiple choice</span>}</div>
                  </div>
                );
              })()}

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
