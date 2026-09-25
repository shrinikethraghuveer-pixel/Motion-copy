"use client";

/**
 * CreatePost — multi-mode composer (standard/media, poll, event) with
 * media attachments, GIF picker, emoji picker, AI sharpening, character
 * ring, audience selector, and draft auto-save.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  Clapperboard,
  Paperclip,
  Search,
  Send,
  Smile,
  Sparkles,
  Loader2,
  Users,
  X,
} from "lucide-react";
import { useToast } from "@/components/motion/toaster";
import { uploadPostMedia } from "@/lib/db/profiles";
import { cn } from "@/lib/utils";

/* ============================== shared types ============================== */

export type PostKind = "standard" | "poll" | "event";

export interface PollDraft {
  question: string;
  options: string[];
  duration: "1" | "3" | "7" | "0";
  votesPerUser: 1 | 99;
  hideResults: boolean;
}

export interface EventDraft {
  title: string;
  date: string;
  time: string;
  endTime: string;
  duration: string;
  venue: string;
  capacity: string; // "" = unlimited
  category: string;
}

export interface ComposerResult {
  kind: PostKind;
  text: string;
  audience: string;
  media: string[]; // attachment names / GIF urls
  poll?: PollDraft;
  event?: EventDraft;
}

/* ============================== constants ============================== */

const AUDIENCES = ["Everyone", "Connections Only", "Campus Only"] as const;

const CATEGORIES = ["Hackathon", "Workshop", "Gaming", "Casual", "Study Group", "Sports"];

const TRENDING_GIFS = [
  { id: "g1", label: "excited", emoji: "🤩", gradient: "from-violet-500/70 to-cyan-500/60" },
  { id: "g2", label: "ship it", emoji: "🚀", gradient: "from-cyan-500/70 to-indigo-500/60" },
  { id: "g3", label: "mind blown", emoji: "🤯", gradient: "from-indigo-500/70 to-fuchsia-500/60" },
  { id: "g4", label: "applause", emoji: "👏", gradient: "from-blue-500/70 to-violet-500/60" },
  { id: "g5", label: "coding", emoji: "💻", gradient: "from-sky-500/70 to-violet-600/60" },
  { id: "g6", label: "celebrate", emoji: "🎉", gradient: "from-violet-600/70 to-sky-500/60" },
  { id: "g7", label: "facepalm", emoji: "🤦", gradient: "from-slate-500/70 to-indigo-500/60" },
  { id: "g8", label: "watching", emoji: "🍿", gradient: "from-fuchsia-500/60 to-cyan-500/60" },
];

const EMOJI_SETS: { name: string; emojis: string[] }[] = [
  { name: "Reactions", emojis: ["😀", "😂", "🥹", "😍", "🤩", "😎", "🤔", "😅", "🙌", "👏", "👍", "🔥", "💜", "✨", "⚡", "🚀"] },
  { name: "Campus life", emojis: ["📚", "✏️", "🎓", "🧪", "🤖", "💻", "🎨", "🏀", "⚽", "🏏", "🎮", "🎤", "🍕", "☕", "🌙", "🏆"] },
  { name: "Feelings", emojis: ["😮‍💨", "😴", "🤯", "🥳", "😭", "😤", "🫠", "🤗", "😬", "🫡", "🙃", "🙈", "💗", "💫", "🌟", "🎯"] },
];

const EVENT_PLACEHOLDER: EventDraft = {
  title: "",
  date: "",
  time: "",
  endTime: "",
  duration: "60",
  venue: "",
  capacity: "",
  category: CATEGORIES[0],
};

const POLL_PLACEHOLDER: PollDraft = { question: "", options: ["", ""], duration: "1", votesPerUser: 1, hideResults: false };

/* ============================== tiny widgets ============================== */

function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span className="pointer-events-none absolute -top-9 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-lg border border-white/10 light:border-zinc-200/80 bg-zinc-950/90 px-2 py-1 text-[10px] font-medium text-zinc-200 light:text-zinc-800 opacity-0 shadow-lg backdrop-blur-xl transition-opacity duration-150 group-hover/tt:opacity-100">
        {label}
      </span>
    </span>
  );
}

function Popover({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} aria-hidden="true" />
      <div className="absolute bottom-12 left-0 z-40 w-72 rounded-xl border border-white/10 light:border-zinc-200/80 bg-zinc-950/95 p-3 shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] backdrop-blur-xl">
        <p className="mb-2 flex items-center justify-between text-xs font-semibold text-zinc-200 light:text-zinc-800">
          {title}
          <button onClick={onClose} className="text-zinc-500 transition hover:text-zinc-200 light:text-zinc-800" aria-label={`Close ${title}`}>
            <X size={13} />
          </button>
        </p>
        {children}
      </div>
    </>
  );
}

/* ============================== main component ============================== */

export function CreatePost({ onPost }: { onPost: (result: ComposerResult) => void }) {
  const { toast } = useToast();

  // ---- mode + shared fields
  const [kind, setKind] = useState<PostKind>("standard");
  const [text, setText] = useState("");
  const [audience, setAudience] = useState<string>(AUDIENCES[0]);

  // ---- attachments
  const [media, setMedia] = useState<string[]>([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [gifOpen, setGifOpen] = useState(false);
  const [gifQuery, setGifQuery] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiTab, setEmojiTab] = useState(0);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // ---- poll / event drafts
  const [poll, setPoll] = useState<PollDraft>(POLL_PLACEHOLDER);
  const [event, setEvent] = useState<EventDraft>(EVENT_PLACEHOLDER);

  // ---- AI sharpening
  const [sharpening, setSharpening] = useState(false);

  // ---- draft auto-save (survives mode switches; restored on mount)
  const DRAFT_KEY = "motion-composer-draft";
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw) as { kind?: PostKind; text?: string; audience?: string; poll?: PollDraft; event?: EventDraft; media?: string[] };
        if (d.kind) setKind(d.kind);
        if (d.text) setText(d.text);
        if (d.audience) setAudience(d.audience);
        if (d.poll) setPoll(d.poll);
        if (d.event) setEvent({ ...EVENT_PLACEHOLDER, ...d.event });
        if (d.media) setMedia(d.media);
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ kind, text, audience, poll, event, media }));
    } catch {
      /* ignore */
    }
  }, [kind, text, audience, poll, event, media]);

  const canPost = useMemo(() => {
    if (kind === "poll") return poll.question.trim() && poll.options.filter((o) => o.trim()).length >= 2;
    if (kind === "event") return event.title.trim() && event.date && event.time && event.venue.trim();
    return text.trim().length > 0 || media.length > 0;
  }, [kind, text, media, poll, event]);

  /* ---------- actions ---------- */

  async function attachFiles(files: FileList | null) {
    if (!files?.length) return;
    const selected = [...files].slice(0, Math.max(0, 4 - media.length));
    if (!selected.length) {
      toast({ kind: "error", title: "You can attach up to four files." });
      return;
    }
    setUploadingMedia(true);
    try {
      const urls = await Promise.all(selected.map(uploadPostMedia));
      setMedia((prev) => [...prev, ...urls].slice(0, 4));
      toast({ kind: "success", title: `${urls.length} attachment${urls.length > 1 ? "s" : ""} added` });
    } catch (error) {
      toast({ kind: "error", title: "Upload failed", description: error instanceof Error ? error.message : "Couldn't attach those files." });
    } finally {
      setUploadingMedia(false);
    }
  }

  function insertEmoji(emoji: string) {
    const el = textRef.current;
    if (!el) {
      setText((t) => t + emoji);
      return;
    }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    setText(text.slice(0, start) + emoji + text.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + emoji.length;
    });
  }

  async function sharpen() {
    const draft = text.trim();
    if (!draft || sharpening) return;
    setSharpening(true);
    try {
      const res = await fetch("/api/ai/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `Rewrite this social post so it is sharper and more engaging. Keep the voice and key details, reply with ONLY the rewritten post.\n\nPost: ${draft}`,
        }),
      });
      const ctype = res.headers.get("content-type") ?? "";
      if (!ctype.includes("text/event-stream")) {
        const data = await res.json().catch(() => ({}));
        toast({ kind: "error", title: "AI sharpen failed", description: data.error ?? "Try again shortly." });
        return;
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let result = "";
      let done = false;
      while (!done) {
        const { done: fin, value } = await reader.read();
        if (fin) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith("data:")) continue;
          const payload = t.slice(5).trim();
          if (payload === "[DONE]") {
            done = true;
            break;
          }
          try {
            const { token } = JSON.parse(payload) as { token?: string };
            if (token) result += token;
          } catch {
            /* skip */
          }
        }
      }
      if (result.trim()) {
        setText(result.trim());
        toast({ kind: "success", title: "Draft sharpened ✨", description: "Groq polished your post." });
      }
    } catch {
      toast({ kind: "error", title: "Connection hiccup", description: "The AI stream dropped — try again." });
    } finally {
      setSharpening(false);
    }
  }

  function submit() {
    if (!canPost) return;
    onPost({
      kind,
      text: text.trim(),
      audience,
      media,
      poll: kind === "poll" ? { ...poll, options: poll.options.filter((o) => o.trim()) } : undefined,
      event: kind === "event" ? { ...event } : undefined,
    });
    // reset everything (auto-save effect clears storage next tick)
    setKind("standard");
    setText("");
    setMedia([]);
    setPoll(POLL_PLACEHOLDER);
    setEvent(EVENT_PLACEHOLDER);
    setAudience(AUDIENCES[0]);
  }

  const modeLabel = kind === "poll" ? "Poll" : kind === "event" ? "Event" : "Post";

  /* ============================== render ============================== */

  return (
    <div className="relative rounded-2xl border border-zinc-800/80 bg-zinc-900/60 p-4 text-zinc-100 backdrop-blur-md light:border-zinc-200/80 light:bg-white/80 light:text-zinc-900">
      {/* ---- top row: audience selector + active-mode chip ---- */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 rounded-full border border-white/10 light:border-zinc-200/80 bg-zinc-900/50 light:bg-zinc-100/80 px-2.5 py-1 text-[11px] font-medium text-zinc-300 light:text-zinc-700">
          <Users size={11} className="text-violet-400" />
          <select
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            className="cursor-pointer appearance-none bg-transparent pr-1 text-[11px] font-medium text-zinc-300 light:text-zinc-700 focus:outline-none [&>option]:bg-zinc-900"
          >
            {AUDIENCES.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        {kind !== "standard" && (
          <span className="composer-swap flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-[11px] font-semibold text-violet-300" key={kind}>
            {kind === "poll" ? <BarChart3 size={11} /> : <CalendarDays size={11} />}
            {modeLabel} mode
          </span>
        )}
      </div>

      {/* ---- standard / shared text ---- */}
      {kind === "standard" ? (
        <textarea
          ref={textRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What's your next motion?"
          className="min-h-16 w-full resize-none bg-transparent text-[15px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none light:text-zinc-900"
        />
      ) : (
        <div key={kind} className="composer-swap">
          {/* ================= MODE B: POLL ================= */}
          {kind === "poll" && (
            <div className="space-y-3">
              <input
                value={poll.question}
                onChange={(e) => setPoll({ ...poll, question: e.target.value })}
                placeholder="Ask a question…"
                className="w-full bg-transparent text-[15px] font-semibold text-zinc-100 light:text-zinc-900 placeholder:text-zinc-500 focus:outline-none"
              />
              <div className="space-y-2">
                {poll.options.map((opt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full border border-white/10 light:border-zinc-200/80 bg-zinc-900/60 light:bg-zinc-100/80 text-[10px] font-bold text-violet-300">
                      {String.fromCharCode(65 + i)}
                    </span>
                    <input
                      value={opt}
                      onChange={(e) => {
                        const options = [...poll.options];
                        options[i] = e.target.value;
                        setPoll({ ...poll, options });
                      }}
                      placeholder={`Option ${i + 1}`}
                      className="h-9 flex-1 rounded-lg border border-white/10 light:border-zinc-200/80 bg-zinc-900/40 light:bg-zinc-100/80 px-3 text-sm text-zinc-200 light:text-zinc-800 placeholder:text-zinc-600 focus:border-violet-500/50 focus:outline-none"
                    />
                    {poll.options.length > 2 && (
                      <button
                        onClick={() => setPoll({ ...poll, options: poll.options.filter((_, j) => j !== i) })}
                        className="text-zinc-600 transition hover:text-rose-400"
                        aria-label={`Remove option ${i + 1}`}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ))}
                {poll.options.length < 6 && (
                  <button
                    onClick={() => setPoll({ ...poll, options: [...poll.options, ""] })}
                    className="text-xs font-semibold text-violet-400 transition hover:text-violet-300"
                  >
                    + Add option
                  </button>
                )}
              </div>

              {/* duration + votes-per-user + results visibility */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <label className="rounded-lg border border-white/10 light:border-zinc-200/80 bg-zinc-900/40 light:bg-zinc-100/80 px-2.5 py-2">
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Duration</span>
                  <select
                    value={poll.duration}
                    onChange={(e) => setPoll({ ...poll, duration: e.target.value as PollDraft["duration"] })}
                    className="w-full cursor-pointer appearance-none bg-transparent text-xs text-zinc-200 light:text-zinc-800 focus:outline-none [&>option]:bg-zinc-900"
                  >
                    <option value="1">1 Day</option>
                    <option value="3">3 Days</option>
                    <option value="7">7 Days</option>
                    <option value="0">No expiration</option>
                  </select>
                </label>
                <label className="rounded-lg border border-white/10 light:border-zinc-200/80 bg-zinc-900/40 light:bg-zinc-100/80 px-2.5 py-2">
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Votes / user</span>
                  <select
                    value={poll.votesPerUser}
                    onChange={(e) => setPoll({ ...poll, votesPerUser: Number(e.target.value) as PollDraft["votesPerUser"] })}
                    className="w-full cursor-pointer appearance-none bg-transparent text-xs text-zinc-200 light:text-zinc-800 focus:outline-none [&>option]:bg-zinc-900"
                  >
                    <option value={1}>1 vote</option>
                    <option value={99}>Multiple choice</option>
                  </select>
                </label>
                <button
                  onClick={() => setPoll({ ...poll, hideResults: !poll.hideResults })}
                  className={cn(
                    "flex items-center justify-between rounded-lg border px-2.5 py-2 text-left transition-colors",
                    poll.hideResults ? "border-violet-500/40 bg-violet-500/10" : "border-white/10 light:border-zinc-200/80 bg-zinc-900/40 light:bg-zinc-100/80"
                  )}
                >
                  <span className="text-xs text-zinc-300 light:text-zinc-700">{poll.hideResults ? "Hidden until end" : "Live results"}</span>
                  <span className={cn("flex h-4 w-7 items-center rounded-full border border-white/10 light:border-zinc-200/80 transition-colors", poll.hideResults ? "bg-violet-500/60" : "bg-zinc-800")}>
                    <span className={cn("mx-0.5 size-3 rounded-full bg-white transition-transform", poll.hideResults && "translate-x-3")} />
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* ================= MODE C: EVENT ================= */}
          {kind === "event" && (
            <div className="space-y-3">
              <input
                value={event.title}
                onChange={(e) => setEvent({ ...event, title: e.target.value })}
                placeholder="Event title — e.g. Late-night build session"
                className="w-full bg-transparent text-[15px] font-semibold text-zinc-100 light:text-zinc-900 placeholder:text-zinc-500 focus:outline-none"
              />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <label className="rounded-lg border border-white/10 light:border-zinc-200/80 bg-zinc-900/40 light:bg-zinc-100/80 px-2.5 py-2">
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Date</span>
                  <input type="date" value={event.date} onChange={(e) => setEvent({ ...event, date: e.target.value })} className="w-full bg-transparent text-xs text-zinc-200 light:text-zinc-800 [color-scheme:dark] focus:outline-none" />
                </label>
                <label className="rounded-lg border border-white/10 light:border-zinc-200/80 bg-zinc-900/40 light:bg-zinc-100/80 px-2.5 py-2">
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Start</span>
                  <input type="time" value={event.time} onChange={(e) => setEvent({ ...event, time: e.target.value })} className="w-full bg-transparent text-xs text-zinc-200 light:text-zinc-800 [color-scheme:dark] focus:outline-none" />
                </label>
                <label className="rounded-lg border border-white/10 light:border-zinc-200/80 bg-zinc-900/40 light:bg-zinc-100/80 px-2.5 py-2">
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Ends</span>
                  <input type="time" value={event.endTime} onChange={(e) => setEvent({ ...event, endTime: e.target.value })} className="w-full bg-transparent text-xs text-zinc-200 light:text-zinc-800 [color-scheme:dark] focus:outline-none" />
                </label>
                <label className="rounded-lg border border-white/10 light:border-zinc-200/80 bg-zinc-900/40 light:bg-zinc-100/80 px-2.5 py-2">
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Estimated duration</span>
                  <select value={event.duration} onChange={(e) => setEvent({ ...event, duration: e.target.value })} className="w-full cursor-pointer appearance-none bg-transparent text-xs text-zinc-200 light:text-zinc-800 focus:outline-none [&>option]:bg-zinc-900">
                    <option value="30">30 minutes</option>
                    <option value="60">1 hour</option>
                    <option value="90">1.5 hours</option>
                    <option value="120">2 hours</option>
                    <option value="180">3 hours</option>
                  </select>
                </label>
              </div>
              <input
                value={event.venue}
                onChange={(e) => setEvent({ ...event, venue: e.target.value })}
                placeholder="Venue — Google Meet / Campus Quad / Room 402"
                className="h-9 w-full rounded-lg border border-white/10 light:border-zinc-200/80 bg-zinc-900/40 light:bg-zinc-100/80 px-3 text-sm text-zinc-200 light:text-zinc-800 placeholder:text-zinc-600 focus:border-violet-500/50 focus:outline-none"
              />
              <div className="grid grid-cols-2 gap-2">
                <label className="rounded-lg border border-white/10 light:border-zinc-200/80 bg-zinc-900/40 light:bg-zinc-100/80 px-2.5 py-2">
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Capacity</span>
                  <input
                    type="number"
                    min={2}
                    placeholder="Unlimited"
                    value={event.capacity}
                    onChange={(e) => setEvent({ ...event, capacity: e.target.value })}
                    className="w-full bg-transparent text-xs text-zinc-200 light:text-zinc-800 placeholder:text-zinc-600 focus:outline-none"
                  />
                </label>
                <label className="rounded-lg border border-white/10 light:border-zinc-200/80 bg-zinc-900/40 light:bg-zinc-100/80 px-2.5 py-2">
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Category</span>
                  <select
                    value={event.category}
                    onChange={(e) => setEvent({ ...event, category: e.target.value })}
                    className="w-full cursor-pointer appearance-none bg-transparent text-xs text-zinc-200 light:text-zinc-800 focus:outline-none [&>option]:bg-zinc-900"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
              </div>
              {/* poster dropzone */}
              <label
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  attachFiles(e.dataTransfer.files);
                }}
                className="flex h-16 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-white/15 bg-zinc-900/30 light:bg-zinc-100/60 text-xs text-zinc-500 transition hover:border-violet-500/40 hover:text-violet-300"
              >
                <Clapperboard size={14} />
                Drop an event poster, or click to upload
                <input type="file" accept="image/*" className="hidden" onChange={(e) => attachFiles(e.target.files)} />
              </label>
            </div>
          )}

          {/* optional caption for poll/event */}
          <textarea
            ref={textRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={kind === "poll" ? "Add context (optional)…" : "Add a caption (optional)…"}
            className="mt-3 min-h-10 w-full resize-none bg-transparent text-sm text-zinc-300 light:text-zinc-700 placeholder:text-zinc-600 focus:outline-none"
          />
        </div>
      )}

      {/* ---- attachment previews ---- */}
      {media.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {media.map((m, i) => (
            <span key={`${m}-${i}`} className="relative flex h-20 max-w-44 items-center gap-1.5 overflow-hidden rounded-lg border border-white/10 light:border-zinc-200/80 bg-zinc-900/60 light:bg-zinc-100/80 px-2 py-1 text-[11px] text-zinc-300 light:text-zinc-700">
              {m.startsWith("data:image/") || /\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(m) ? <img src={m} alt="Post attachment preview" className="h-full max-w-32 rounded object-cover" />
                : m.startsWith("data:video/") || /\.(mp4|webm|mov)(\?.*)?$/i.test(m) ? <video src={m} controls className="h-full max-w-32 rounded object-cover" />
                  : <span className="max-w-32 truncate">{m.split("/").pop()}</span>}
              <button onClick={() => setMedia((prev) => prev.filter((_, j) => j !== i))} className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-zinc-950/80 text-zinc-400 transition hover:text-rose-400" aria-label={`Remove attachment ${i + 1}`}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* ---- toolbar ---- */}
      <div className="mt-2 flex items-center justify-between border-t border-white/10 light:border-zinc-200/80 pt-2.5">
        <div className="flex items-center gap-0.5 text-zinc-500">
          {/* media attach */}
          <Tooltip label="Attach media — images, video, docs">
            <button onClick={() => fileRef.current?.click()} className="rounded-full p-2 transition hover:bg-white/5 hover:text-violet-300" aria-label="Attach media">
              <Paperclip size={18} />
            </button>
          </Tooltip>
          <input ref={fileRef} type="file" multiple accept="image/*,video/*,.pdf,.doc,.docx,.txt" className="hidden" onChange={(e) => attachFiles(e.target.files)} />

          {/* GIF picker */}
          <div className="relative">
            <Tooltip label="Add a GIF">
              <button
                onClick={() => {
                  setGifOpen((v) => !v);
                  setEmojiOpen(false);
                }}
                className={cn("rounded-full p-2 text-[10px] font-black tracking-tight transition hover:bg-white/5 hover:text-violet-300", gifOpen && "bg-violet-500/15 text-violet-300")}
                aria-label="Add GIF"
              >
                GIF
              </button>
            </Tooltip>
            <Popover open={gifOpen} onClose={() => setGifOpen(false)} title="Trending GIFs">
              <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-white/10 light:border-zinc-200/80 bg-zinc-900/60 light:bg-zinc-100/80 px-2 py-1.5">
                <Search size={12} className="text-zinc-500" />
                <input value={gifQuery} onChange={(e) => setGifQuery(e.target.value)} placeholder="Search GIFs" className="w-full bg-transparent text-xs text-zinc-200 light:text-zinc-800 placeholder:text-zinc-600 focus:outline-none" />
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {TRENDING_GIFS.filter((g) => g.label.includes(gifQuery.toLowerCase())).map((g) => (
                  <button
                    key={g.id}
                    onClick={() => {
                      setMedia((prev) => [...prev, `🎞 ${g.label}.gif`].slice(0, 4));
                      setGifOpen(false);
                    }}
                    className={cn("grid aspect-square place-items-center rounded-lg bg-gradient-to-br text-lg transition hover:scale-105 hover:ring-1 hover:ring-violet-400/50", g.gradient)}
                    title={`gif: ${g.label}`}
                  >
                    {g.emoji}
                  </button>
                ))}
              </div>
            </Popover>
          </div>

          {/* emoji picker */}
          <div className="relative">
            <Tooltip label="Emoji">
              <button
                onClick={() => {
                  setEmojiOpen((v) => !v);
                  setGifOpen(false);
                }}
                className={cn("rounded-full p-2 transition hover:bg-white/5 hover:text-violet-300", emojiOpen && "bg-violet-500/15 text-violet-300")}
                aria-label="Add emoji"
              >
                <Smile size={18} />
              </button>
            </Tooltip>
            <Popover open={emojiOpen} onClose={() => setEmojiOpen(false)} title="Emoji">
              <div className="mb-2 flex gap-1">
                {EMOJI_SETS.map((s, i) => (
                  <button
                    key={s.name}
                    onClick={() => setEmojiTab(i)}
                    className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold transition", emojiTab === i ? "bg-violet-500/20 text-violet-300" : "text-zinc-500 hover:text-zinc-300 light:text-zinc-700")}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-8 gap-0.5">
                {EMOJI_SETS[emojiTab].emojis.map((e) => (
                  <button key={e} onClick={() => insertEmoji(e)} className="grid size-7 place-items-center rounded-md text-base transition hover:scale-110 hover:bg-white/10">
                    {e}
                  </button>
                ))}
              </div>
            </Popover>
          </div>

          {/* poll mode */}
          <Tooltip label={kind === "poll" ? "Exit poll mode" : "Create a poll"}>
            <button
              onClick={() => setKind(kind === "poll" ? "standard" : "poll")}
              className={cn("rounded-full p-2 transition hover:bg-white/5 hover:text-violet-300", kind === "poll" && "bg-violet-500/15 text-violet-300")}
              aria-label="Toggle poll mode"
            >
              <BarChart3 size={18} />
            </button>
          </Tooltip>

          {/* event mode */}
          <Tooltip label={kind === "event" ? "Exit event mode" : "Create an event"}>
            <button
              onClick={() => setKind(kind === "event" ? "standard" : "event")}
              className={cn("rounded-full p-2 transition hover:bg-white/5 hover:text-violet-300", kind === "event" && "bg-violet-500/15 text-violet-300")}
              aria-label="Toggle event mode"
            >
              <CalendarDays size={18} />
            </button>
          </Tooltip>

          {/* AI sharpen */}
          <Tooltip label="Groq AI — sharpen draft">
            <button
              onClick={() => void sharpen()}
              disabled={!text.trim() || sharpening}
              className={cn("rounded-full p-2 transition hover:bg-white/5 hover:text-violet-300", sharpening && "text-violet-300")}
              aria-label="Sharpen with AI"
            >
              {sharpening ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
            </button>
          </Tooltip>
        </div>

        {/* right side: char ring + submit */}
        <div className="flex items-center gap-3">
          <button
            onClick={submit}
            disabled={!canPost || uploadingMedia}
            className="flex h-9 items-center gap-1.5 rounded-full bg-violet-600 px-5 text-sm font-semibold text-white transition hover:bg-violet-500 hover:shadow-[0_0_18px_rgba(139,92,246,0.35)] disabled:opacity-40 disabled:shadow-none"
          >
            <Send size={13} />
            {modeLabel === "Post" ? "Post" : `Post ${modeLabel}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CreatePost;
