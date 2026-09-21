"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock,
  Globe,
  Heart,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Repeat2,
  Search,
  Send,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import { AiAssistant } from "@/components/motion/ai-assistant";
import { CreatePost, type ComposerResult } from "@/components/motion/create-post";
import { Navbar } from "@/components/motion/navbar";
import { ProfileDrawer } from "@/components/motion/profile-drawer";
import { getCurrentUserSession } from "@/lib/supabase/auth";
import { cn } from "@/lib/utils";

/* ============================== types ============================== */

interface PollChoice {
  label: string;
  votes: number;
}

interface FeedCard {
  id: string;
  name: string;
  handle: string;
  time: string;
  audience: string;
  kind: "standard" | "poll" | "event";
  text: string;
  media: string[];
  poll?: { question: string; choices: PollChoice[]; votesPerUser: number; total: number; endsIn: string };
  event?: { title: string; date: string; time: string; duration: string; venue: string; category: string; attending: number };
  replies: number;
  reposts: number;
  likes: number;
  aiGenerated?: boolean;
}

/* ============================== seed feed ============================== */

const CARDS: FeedCard[] = [
  {
    id: "c1",
    name: "Maya Chen",
    handle: "@mayacodes",
    time: "12m",
    audience: "Everyone",
    kind: "standard",
    text: "ship the ugly version. feedback beats perfection every single time — hackathon demo in 6 hours and our build finally compiles 🚀",
    media: [],
    replies: 24,
    reposts: 11,
    likes: 214,
  },
  {
    id: "c2",
    name: "Motion Weekly",
    handle: "@motionweekly",
    time: "1h",
    audience: "Everyone",
    kind: "event",
    text: "Our flagship fall event is live — bring your robot, your laptop, or just your curiosity.",
    media: [],
    event: {
      title: "Northgate Robotics Fall Kickoff",
      date: "Sat, Oct 3",
      time: "10:00 AM",
      duration: "4 hrs",
      venue: "Northgate Campus Auditorium",
      category: "Hackathon",
      attending: 42,
    },
    replies: 8,
    reposts: 14,
    likes: 96,
  },
  {
    id: "c3",
    name: "Zoe Alvarez",
    handle: "@zoedesigns",
    time: "3h",
    audience: "Connections Only",
    kind: "poll",
    text: "Deciding what to teach at the next design workshop — you pick 👇",
    media: [],
    poll: {
      question: "Which workshop should I run?",
      choices: [
        { label: "Figma prototyping", votes: 41 },
        { label: "Portfolio teardown", votes: 27 },
        { label: "Motion design 101", votes: 33 },
      ],
      votesPerUser: 1,
      total: 101,
      endsIn: "ends in 2 days",
    },
    replies: 15,
    reposts: 7,
    likes: 182,
  },
  {
    id: "c4",
    name: "Arjun Mehta",
    handle: "@arjun.builds",
    time: "5h",
    audience: "Everyone",
    kind: "standard",
    text: "3:47 AM build nights hit different when the whole team is on one call. Coffee count: lost.",
    media: ["🖼 build-night.jpg", "🎬 timelapse.mp4"],
    replies: 6,
    reposts: 3,
    likes: 73,
  },
];

const QUICK_PROMPTS = [
  "Draft a hype post about our hackathon project",
  "Write a short bio for my Motion profile",
  "Ideas for recruiting teammates for a robotics build",
  "Announcement copy for a study-group session",
];

const TRENDS = [
  { tag: "#BuildInPublic", posts: "2,418 posts" },
  { tag: "#HackathonSeason", posts: "1,902 posts" },
  { tag: "#LineFollower", posts: "842 posts" },
];

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/* ============================== feed sub-renders ============================== */

/** Media / GIF attachments — inline grid with graceful tiles. */
function MediaGrid({ media }: { media: string[] }) {
  if (!media.length) return null;
  return (
    <div className={cn("mt-2.5 grid gap-1.5 overflow-hidden rounded-xl", media.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
      {media.map((m, i) => (
        <div key={i} className="group relative flex h-36 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-gradient-to-br from-violet-500/15 via-zinc-900 to-cyan-500/15">
          <span className="text-3xl transition-transform duration-300 group-hover:scale-110">{m.startsWith("🎞") ? "🎞" : m.startsWith("🎬") ? "🎬" : m.startsWith("📄") ? "📄" : "🖼"}</span>
          <span className="absolute bottom-1.5 left-2 max-w-[90%] truncate rounded-md bg-black/50 px-1.5 py-0.5 text-[10px] text-zinc-300 backdrop-blur-sm">{m.replace(/^[^\s]+\s/, "")}</span>
        </div>
      ))}
    </div>
  );
}

/** Poll body — clickable choices with animated percentage bars. */
function PollBody({ poll, voted, onVote }: { poll: NonNullable<FeedCard["poll"]>; voted: boolean; onVote: (labels: string[]) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const total = Math.max(poll.total + (voted ? picked.length : 0), 1);

  function toggle(label: string, _index: number) {
    if (voted) return;
    const next = poll.votesPerUser === 1 ? [label] : picked.includes(label) ? picked.filter((p) => p !== label) : [...picked, label];
    setPicked(next);
  }

  function vote() {
    if (picked.length) onVote(picked);
  }

  return (
    <div className="mt-2.5 space-y-1.5">
      <p className="text-sm font-semibold text-zinc-100">{poll.question}</p>
      {poll.choices.map((c, i) => {
        const share = Math.round(((c.votes + (voted && picked.includes(c.label) ? 1 : 0)) / total) * 100);
        return (
          <button
            key={c.label}
            onClick={() => toggle(c.label, i)}
            disabled={voted}
            className={cn(
              "relative block w-full overflow-hidden rounded-lg border text-left transition-colors",
              voted ? "border-white/10" : "border-violet-500/30 hover:border-violet-400/60 hover:bg-violet-500/5"
            )}
          >
            {/* animated result fill */}
            {voted && (
              <span
                className="bar-grow absolute inset-y-0 left-0 bg-gradient-to-r from-violet-500/30 to-cyan-500/25"
                style={{ width: `${share}%` }}
              />
            )}
            <span className="relative z-10 flex items-center justify-between px-3 py-2 text-xs">
              <span className={cn("font-medium", voted && picked.includes(c.label) ? "text-violet-300" : "text-zinc-300")}>
                {c.label}
                {voted && picked.includes(c.label) && <CheckCircle2 size={12} className="ml-1.5 inline text-violet-400" />}
              </span>
              {voted && <span className="font-bold tabular-nums text-zinc-200">{share}%</span>}
            </span>
          </button>
        );
      })}
      <div className="flex items-center gap-2 pt-0.5 text-[11px] text-zinc-500">
        {voted ? (
          <span>
            <span className="font-semibold text-zinc-300">{poll.total + picked.length} votes</span> · {poll.endsIn}
          </span>
        ) : (
          <>
            <button
              onClick={vote}
              disabled={!picked.length}
              className="h-7 rounded-full bg-violet-600 px-3.5 text-[11px] font-semibold text-white transition hover:bg-violet-500 disabled:opacity-40"
            >
              Vote{poll.votesPerUser > 1 ? " (multi)" : ""}
            </button>
            <span>{poll.total} votes so far · {poll.endsIn}</span>
          </>
        )}
        <span className="ml-auto rounded-full border border-white/10 px-2 py-0.5">
          {poll.votesPerUser > 1 ? "Multi-choice" : "1 vote per user"}
        </span>
      </div>
    </div>
  );
}

/** Event body — high-profile card with RSVP + live counter. */
function EventBody({ event, going, onRsvp }: { event: NonNullable<FeedCard["event"]>; going: boolean; onRsvp: () => void }) {
  return (
    <div className="mt-2.5 overflow-hidden rounded-xl border border-violet-500/25 bg-gradient-to-br from-violet-500/10 via-zinc-900/60 to-cyan-500/10">
      {/* banner */}
      <div className="relative flex h-20 items-end justify-between bg-gradient-to-r from-violet-600/40 via-indigo-500/30 to-cyan-500/30 p-3">
        <span className="rounded-full border border-white/20 bg-black/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/90 backdrop-blur-sm">
          {event.category}
        </span>
        <span className="flex items-center gap-1 rounded-full border border-white/20 bg-black/40 px-2 py-0.5 text-[10px] font-semibold text-white/90 backdrop-blur-sm">
          <CalendarDays size={10} /> {event.date}
        </span>
      </div>
      <div className="p-3">
        <p className="text-sm font-bold text-zinc-100">{event.title}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-400">
          <span className="flex items-center gap-1">
            <CalendarDays size={11} className="text-violet-400" /> {event.date} · {event.time}
          </span>
          <span className="flex items-center gap-1">
            <Clock size={11} className="text-cyan-400" /> {event.duration}
          </span>
          <span className="flex items-center gap-1">
            <MapPin size={11} className="text-rose-400" /> {event.venue}
          </span>
        </div>
        <div className="mt-2.5 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400">
            <Users size={12} className={cn("text-violet-400", going && "text-emerald-400")} />
            <span className="tabular-nums">{event.attending + (going ? 1 : 0)} attending</span>
          </span>
          <button
            onClick={onRsvp}
            className={cn(
              "h-7 rounded-full px-4 text-xs font-semibold transition-all duration-300",
              going
                ? "bg-emerald-500/20 text-emerald-300"
                : "bg-violet-600 text-white hover:bg-violet-500 hover:shadow-[0_0_16px_rgba(139,92,246,0.35)]"
            )}
          >
            {going ? "Going ✓" : "RSVP"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================== page ============================== */

export default function MotionHome() {
  const router = useRouter();
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [seed, setSeed] = useState<string | null>(null);
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [pressed, setPressed] = useState<string | null>(null);
  const [feed, setFeed] = useState<FeedCard[]>(CARDS);
  const [votedPolls, setVotedPolls] = useState<Set<string>>(new Set());
  const [rsvped, setRsvped] = useState<Set<string>>(new Set());

  // Signed-in users who skipped onboarding go through the questionnaire first.
  useEffect(() => {
    void getCurrentUserSession().then((s) => {
      if (s?.profile && s.profile.onboarding_completed === false) {
        router.replace("/onboarding");
      }
    });
  }, [router]);

  function toggleLike(id: string) {
    setLiked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Fire the per-action press animation (re-click re-triggers it). */
  function press(postId: string, action: string) {
    setPressed(`${postId}:${action}`);
    window.setTimeout(() => {
      setPressed((cur) => (cur === `${postId}:${action}` ? null : cur));
    }, 600);
  }

  function openAssistant(withPrompt?: string) {
    setSeed(withPrompt ?? null);
    setAssistantOpen(true);
  }

  /** Composer submit → prepend the correctly-typed card. */
  function handlePost(result: ComposerResult) {
    const id = `me-${Date.now()}`;
    const card: FeedCard = {
      id,
      name: "You",
      handle: "@you",
      time: "now",
      audience: result.audience,
      kind: result.kind,
      text: result.text,
      media: result.media,
      poll:
        result.kind === "poll" && result.poll
          ? {
              question: result.poll.question,
              choices: result.poll.options.filter(Boolean).map((label) => ({ label, votes: 0 })),
              votesPerUser: result.poll.votesPerUser,
              total: 0,
              endsIn: result.poll.duration === "0" ? "no expiration" : `ends in ${result.poll.duration} day${result.poll.duration === "1" ? "" : "s"}`,
            }
          : undefined,
      event:
        result.kind === "event" && result.event
          ? {
              title: result.event.title,
              date: result.event.date,
              time: result.event.time,
              duration: result.event.endTime ? "see schedule" : "TBD",
              venue: result.event.venue,
              category: result.event.category,
              attending: 0,
            }
          : undefined,
      replies: 0,
      reposts: 0,
      likes: 0,
    };
    setFeed((prev) => [card, ...prev]);
  }

  function castVote(postId: string, labels: string[]) {
    setFeed((prev) =>
      prev.map((c) =>
        c.id === postId && c.poll
          ? {
              ...c,
              poll: {
                ...c.poll,
                total: c.poll.total + labels.length,
                choices: c.poll.choices.map((ch) => (labels.includes(ch.label) ? { ...ch, votes: ch.votes + 1 } : ch)),
              },
            }
          : c
      )
    );
    setVotedPolls((prev) => new Set(prev).add(postId));
  }

  function toggleRsvp(id: string) {
    setRsvped((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="min-h-screen text-zinc-100">
      <Navbar onAssistant={() => openAssistant()} onProfile={() => setProfileOpen(true)} />

      <div className="mx-auto max-w-7xl px-4 pb-28 pt-6 lg:px-6 lg:pb-12 lg:pt-24">
        {/* ================= hero ================= */}
        <section className="liquid-glass relative overflow-hidden p-6 sm:p-8">
          <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-violet-600/15 blur-3xl" />
          <div className="relative">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-zinc-950/60 px-3 py-1.5 text-xs backdrop-blur-xl">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
              </span>
              <span className="font-medium text-zinc-300">Groq AI online · gpt-oss-20b</span>
            </div>
            <h1 className="mt-4 max-w-xl text-3xl font-semibold tracking-tight text-zinc-100 sm:text-4xl">
              Where students build <span className="bg-gradient-to-r from-cyan-400 to-violet-500 bg-clip-text text-transparent">motion</span>
            </h1>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-zinc-400">
              Share what you&apos;re making, find collaborators, and let the built-in Groq assistant sharpen every post.
            </p>
            <div className="mt-5 flex flex-wrap gap-2.5">
              <button
                onClick={() => openAssistant("Draft a hype post about what I'm building this week")}
                className="inline-flex h-10 items-center gap-2 rounded-full bg-gradient-to-r from-cyan-500 to-violet-600 px-5 text-sm font-semibold text-white shadow-[0_0_24px_rgba(139,92,246,0.35)] transition hover:opacity-90"
              >
                <Zap size={15} />
                Generate a post with AI
              </button>
              <button
                onClick={() => openAssistant()}
                className="inline-flex h-10 items-center gap-2 rounded-full border border-white/10 bg-zinc-900/50 px-5 text-sm font-medium text-zinc-300 transition hover:border-violet-500/40 hover:text-violet-300"
              >
                <Sparkles size={15} />
                Open AI Studio
              </button>
            </div>
          </div>
        </section>

        {/* ================= dual columns ================= */}
        <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          {/* ---- center feed ---- */}
          <main className="space-y-3">
            {/* multi-mode composer */}
            <CreatePost onPost={handlePost} />

            {/* feed cards */}
            {feed.map((card) => (
              <article
                key={card.id}
                className="liquid-glass composer-swap p-4 transition-all duration-200 hover:border-violet-500/30 hover:shadow-[0_0_28px_rgba(139,92,246,0.12)]"
              >
                <div className="flex gap-3">
                  <div className="grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-cyan-500 to-violet-600 text-xs font-bold text-white">
                    {initials(card.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm">
                      <span className="font-semibold text-zinc-100">{card.name}</span>
                      <span className="text-zinc-400">{card.handle}</span>
                      <span className="text-zinc-600">· {card.time}</span>
                      {/* audience chip */}
                      {card.audience !== "Everyone" && (
                        <span className="rounded-full border border-white/10 bg-zinc-900/60 px-1.5 py-0.5 text-[9px] font-medium text-zinc-400">
                          {card.audience}
                        </span>
                      )}
                      {card.kind === "event" && (
                        <span className="ml-0.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-300">
                          Event
                        </span>
                      )}
                      {card.kind === "poll" && (
                        <span className="ml-0.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-300">
                          Poll
                        </span>
                      )}
                      {card.aiGenerated && (
                        <span className="ml-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-300">
                          Groq AI Generated
                        </span>
                      )}
                      <button className="ml-auto rounded-full p-1.5 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200" aria-label="More">
                        <MoreHorizontal size={16} />
                      </button>
                    </div>
                    {card.text && <p className="mt-1.5 whitespace-pre-wrap text-[15px] leading-relaxed text-zinc-200">{card.text}</p>}

                    {/* ---- typed bodies ---- */}
                    {card.kind === "event" && card.event && (
                      <EventBody event={card.event} going={rsvped.has(card.id)} onRsvp={() => toggleRsvp(card.id)} />
                    )}
                    {card.kind === "poll" && card.poll && (
                      <PollBody poll={card.poll} voted={votedPolls.has(card.id)} onVote={(labels) => castVote(card.id, labels)} />
                    )}
                    {card.kind === "standard" && card.media.length > 0 && <MediaGrid media={card.media} />}

                    {/* ---- action bar ---- */}
                    <div className="mt-3 flex items-center gap-2.5">
                      {/* Reply — bubble pop */}
                      <button
                        onClick={() => press(card.id, "reply")}
                        className="group flex items-center gap-1.5 rounded-full px-1.5 py-1 text-[13px] font-semibold text-zinc-400 transition-colors hover:text-cyan-300"
                      >
                        <span
                          key={pressed === `${card.id}:reply` ? `r-${Date.now()}` : "r-idle"}
                          className={cn(
                            "grid size-8 place-items-center rounded-full transition-colors group-hover:bg-cyan-500/15",
                            pressed === `${card.id}:reply` && "animate-[action-pop_0.5s_ease]"
                          )}
                        >
                          <MessageCircle size={19} />
                        </span>
                        {card.replies}
                      </button>
                      {/* Repost — spin */}
                      <button
                        onClick={() => press(card.id, "repost")}
                        className="group flex items-center gap-1.5 rounded-full px-1.5 py-1 text-[13px] font-semibold text-zinc-400 transition-colors hover:text-violet-300"
                      >
                        <span
                          key={pressed === `${card.id}:repost` ? `rp-${Date.now()}` : "rp-idle"}
                          className={cn(
                            "grid size-8 place-items-center rounded-full transition-colors group-hover:bg-violet-500/15",
                            pressed === `${card.id}:repost` && "animate-[action-spin_0.55s_ease]"
                          )}
                        >
                          <Repeat2 size={20} />
                        </span>
                        {card.reposts}
                      </button>
                      {/* Like — heartbeat */}
                      <button
                        onClick={() => { toggleLike(card.id); press(card.id, "like"); }}
                        className={cn(
                          "group flex items-center gap-1.5 rounded-full px-1.5 py-1 text-[13px] font-semibold transition-colors",
                          liked.has(card.id) ? "text-violet-400" : "text-zinc-400 hover:text-violet-300"
                        )}
                      >
                        <span
                          key={pressed === `${card.id}:like` ? `l-${Date.now()}` : "l-idle"}
                          className={cn(
                            "grid size-8 place-items-center rounded-full transition-colors group-hover:bg-violet-500/15",
                            pressed === `${card.id}:like` && "animate-[action-heartbeat_0.5s_ease]"
                          )}
                        >
                          <Heart size={19} className={liked.has(card.id) ? "fill-violet-400" : ""} />
                        </span>
                        {card.likes + (liked.has(card.id) ? 1 : 0)}
                      </button>
                      {/* Share — whoosh */}
                      <button
                        onClick={() => press(card.id, "share")}
                        className="group flex items-center gap-1.5 rounded-full px-1.5 py-1 text-[13px] font-semibold text-zinc-400 transition-colors hover:text-zinc-200"
                      >
                        <span
                          key={pressed === `${card.id}:share` ? `s-${Date.now()}` : "s-idle"}
                          className={cn(
                            "grid size-8 place-items-center rounded-full transition-colors group-hover:bg-white/5",
                            pressed === `${card.id}:share` && "animate-[action-whoosh_0.55s_ease]"
                          )}
                        >
                          <Send size={18} />
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </main>

          {/* ---- AI studio rail ---- */}
          <aside className="space-y-4">
            <div className="xl:sticky xl:top-24 xl:space-y-4">
              <div className="liquid-glass p-4">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                    <Sparkles size={15} className="text-violet-400" />
                    AI Studio
                  </h3>
                  <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-300">
                    Groq
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
                  One tap to a polished draft. Pick a starting point:
                </p>
                <div className="mt-3 space-y-2">
                  {QUICK_PROMPTS.map((p) => (
                    <button
                      key={p}
                      onClick={() => openAssistant(p)}
                      className="w-full rounded-lg border border-white/10 bg-zinc-900/40 px-3 py-2 text-left text-xs text-zinc-300 transition-all hover:border-violet-500/40 hover:text-violet-200 hover:shadow-[0_0_14px_rgba(139,92,246,0.2)]"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div className="liquid-glass p-4">
                <h3 className="text-sm font-semibold text-zinc-100">Trending in Motion</h3>
                <div className="mt-3 space-y-3">
                  {TRENDS.map((t) => (
                    <button key={t.tag} className="block text-left transition hover:opacity-80">
                      <p className="text-sm font-medium text-zinc-200">{t.tag}</p>
                      <p className="text-xs text-zinc-400">{t.posts}</p>
                    </button>
                  ))}
                </div>
              </div>

              <p className="px-2 text-[11px] text-zinc-500">
                Motion © 2026 · Terms · Privacy
              </p>
              <div className="flex items-center gap-2 px-2 text-[11px] text-zinc-500">
                <Globe size={12} />
                English
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* ---- overlays ---- */}
      <AiAssistant open={assistantOpen} onClose={() => setAssistantOpen(false)} seed={seed} />
      <ProfileDrawer open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  );
}
