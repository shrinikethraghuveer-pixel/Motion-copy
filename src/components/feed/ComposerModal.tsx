"use client";

import { useState } from "react";
import { CalendarDays, ImageIcon, Sparkles, X } from "lucide-react";
import { post } from "@/lib/client";
import { useSession, useUI } from "@/components/providers";
import { Modal, PulseBadge } from "@/components/ui/primitives";
import type { FeedPost } from "@/lib/schema";

export default function ComposerModal({ onClose, onPosted }: { onClose: () => void; onPosted?: (p: FeedPost) => void }) {
  const { me } = useSession();
  const { toast } = useUI();
  const [kind, setKind] = useState<"social" | "opportunity">("social");
  const [text, setText] = useState("");
  const [media, setMedia] = useState<{ kind: "art"; seed: string; label: string } | null>(null);
  const [evTitle, setEvTitle] = useState("");
  const [evDate, setEvDate] = useState("");
  const [evLoc, setEvLoc] = useState("");
  const [evKind, setEvKind] = useState<"internship" | "hackathon" | "event">("event");
  const [busy, setBusy] = useState(false);

  const maxLen = 500;

  const submit = async () => {
    if (busy) return;
    if (!text.trim() && !media) {
      toast("Write something or add a visual first");
      return;
    }
    if (kind === "opportunity" && (!evTitle.trim() || !evDate)) {
      toast("Opportunity posts need a title and date");
      return;
    }
    setBusy(true);
    try {
      const res = await post<{ post: FeedPost }>("/api/posts", {
        type: kind,
        text: text.trim(),
        media,
        event: kind === "opportunity" ? { title: evTitle, date: new Date(evDate).toISOString(), location: evLoc, kind: evKind } : undefined,
      });
      toast(kind === "opportunity" ? "Pulse posted ⚡" : "Posted to Motion");
      onPosted?.(res.post);
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not post");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} wide>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-lg font-bold">Create Post</h2>
        <button onClick={onClose} className="rounded-full border border-edge p-1.5 text-mist hover:text-ink" aria-label="Close">
          <X size={16} />
        </button>
      </div>

      <div className="liquid-track mb-5 self-start">
        {(["social", "opportunity"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`rounded-full px-5 py-1.5 text-sm font-semibold transition ${kind === k ? "text-gold" : "text-mist hover:text-ink"}`}
          >
            {k === "social" ? "Social" : "Opportunity"}
          </button>
        ))}
        <span className="liquid-thumb" style={{ left: kind === "social" ? 4 : "50%", width: "calc(50% - 6px)" }} />
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, maxLen))}
        rows={4}
        placeholder={kind === "social" ? "What are you building, watching, winning?" : "Share the opportunity — internships, hackathons, events…"}
        className="w-full resize-none rounded-2xl border border-edge bg-surface/70 p-4 text-[15px] placeholder:text-mist/60 focus:border-ice/40"
      />
      <div className="mt-1 text-right text-xs text-mist">
        {text.length}/{maxLen} · <span className="text-gold/80">Motion+ raises limits later</span>
      </div>

      {media && (
        <div className="relative mt-3 overflow-hidden rounded-2xl border border-edge">
          <div
            className="h-44 w-full"
            style={{
              background: `linear-gradient(120deg, hsl(${hash(media.seed) % 360} 65% 45%), hsl(${(hash(media.seed) * 7) % 360} 70% 35%))`,
            }}
          />
          <div className="absolute bottom-2 left-3 text-xs font-medium text-white/85">{media.label}</div>
          <button onClick={() => setMedia(null)} className="absolute right-2 top-2 rounded-full bg-canvas/70 p-1.5 text-white" aria-label="Remove media">
            <X size={14} />
          </button>
        </div>
      )}

      {kind === "opportunity" && (
        <div className="mt-4 space-y-3 rounded-2xl border border-gold/25 bg-gold-soft/50 p-4">
          <div className="flex items-center gap-2">
            <PulseBadge label="Pulse" />
            <span className="text-xs text-mist">Opportunity post with event card</span>
          </div>
          <input value={evTitle} onChange={(e) => setEvTitle(e.target.value)} placeholder="Event title (e.g. Spring Internship Night)" className="w-full rounded-xl border border-edge bg-surface/80 px-3 py-2 text-sm placeholder:text-mist/60" />
          <div className="grid grid-cols-2 gap-3">
            <input type="datetime-local" value={evDate} onChange={(e) => setEvDate(e.target.value)} className="rounded-xl border border-edge bg-surface/80 px-3 py-2 text-sm [color-scheme:dark]" />
            <input value={evLoc} onChange={(e) => setEvLoc(e.target.value)} placeholder="Location (or Remote)" className="rounded-xl border border-edge bg-surface/80 px-3 py-2 text-sm placeholder:text-mist/60" />
          </div>
          <div className="flex gap-2">
            {(["internship", "hackathon", "event"] as const).map((k) => (
              <button key={k} onClick={() => setEvKind(k)} className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize transition ${evKind === k ? "border-gold/50 bg-gold-soft text-gold" : "border-edge text-mist hover:text-ink"}`}>
                {k}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 flex items-center justify-between">
        <button
          onClick={() => setMedia({ kind: "art", seed: Math.random().toString(36).slice(2, 8), label: "image upload · demo art" })}
          className="flex items-center gap-2 rounded-full border border-edge px-3.5 py-2 text-sm text-mist transition hover:border-ice/40 hover:text-ice"
        >
          <ImageIcon size={16} /> Add image
        </button>
        <button
          onClick={submit}
          disabled={busy}
          className="flex items-center gap-2 rounded-full bg-gradient-to-r from-gold to-amber-500 px-6 py-2.5 font-display text-sm font-bold text-canvas transition hover:brightness-110 disabled:opacity-50"
        >
          <Sparkles size={16} /> {busy ? "Posting…" : kind === "opportunity" ? "Post Pulse" : "Post"}
        </button>
      </div>
    </Modal>
  );
}

function hash(s: string): number {
  let a = 0;
  for (let i = 0; i < s.length; i++) a = (a * 31 + s.charCodeAt(i)) % 360;
  return a;
}
