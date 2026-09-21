"use client";

/**
 * My Space — the personal hub. Clean, spacious, teen-builder energy:
 * creations + skills on the left, identity + events on the right.
 * Uses the shared liquid-glass system; no theme changes.
 */

import { useState } from "react";
import {
  BadgeCheck,
  CalendarDays,
  Clock,
  GraduationCap,
  Loader2,
  MapPin,
  PencilLine,
  Plus,
  Sparkles,
  Users,
} from "lucide-react";
import { Navbar } from "@/components/motion/navbar";
import { useToast } from "@/components/motion/toaster";
import { cn } from "@/lib/utils";

/* ============================== mock data ============================== */

interface Project {
  id: string;
  title: string;
  description: string;
  status: "In Progress" | "Collab Open" | "Shipped 🚀";
  collaborators: string[];
}

const PROJECTS: Project[] = [
  {
    id: "p1",
    title: "Line-Follower Mk III",
    description: "Third-gen bot with a custom PCB and PID tuning.",
    status: "In Progress",
    collaborators: ["AM", "NK"],
  },
  {
    id: "p2",
    title: "CampusMap — student wayfinding",
    description: "React Native app mapping the fastest class routes.",
    status: "Collab Open",
    collaborators: ["MC"],
  },
  {
    id: "p3",
    title: "One-Minute Study Hacks",
    description: "Short-form video series on study techniques.",
    status: "Shipped 🚀",
    collaborators: ["ZD", "SQ", "DD"],
  },
];

const SKILLS = ["React", "Python", "UI/UX", "Robotics", "Video Editing", "Figma"];
const PASSIONS = ["#Hackathons", "#AI", "#Gaming", "#BuildInPublic"];

interface MyEvent {
  id: string;
  title: string;
  date: string;
  time: string;
  venue: string;
  role: "Hosting" | "Attending";
  going: number;
}

const MY_EVENTS: MyEvent[] = [
  {
    id: "e1",
    title: "Northgate Robotics Fall Kickoff",
    date: "Sat, Oct 3",
    time: "10:00 AM",
    venue: "Northgate Campus Auditorium",
    role: "Hosting",
    going: 42,
  },
  {
    id: "e2",
    title: "Hackathon Warm-up: Team Forming",
    date: "Fri, Oct 9",
    time: "7:00 PM",
    venue: "Virtual",
    role: "Attending",
    going: 63,
  },
];

/* ============================== bits ============================== */

const STATUS_STYLE: Record<Project["status"], string> = {
  "In Progress": "border-amber-500/30 bg-amber-500/10 text-amber-300",
  "Collab Open": "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
  "Shipped 🚀": "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
};

function Avatars({ stack }: { stack: string[] }) {
  return (
    <div className="flex -space-x-1.5">
      {stack.map((a, i) => (
        <span
          key={`${a}-${i}`}
          className="grid size-6 place-items-center rounded-full border border-zinc-950 bg-gradient-to-br from-cyan-500 to-violet-600 text-[8px] font-bold text-white"
        >
          {a}
        </span>
      ))}
    </div>
  );
}

/* ============================== page ============================== */

export default function MySpacePage() {
  const { toast } = useToast();
  const [bio, setBio] = useState(
    "16 · builder of small robots and shorter videos. currently shipping a wayfinding app for my campus."
  );
  const [sharpening, setSharpening] = useState(false);
  const [rsvps, setRsvps] = useState<Record<string, boolean>>({});

  async function sharpenBio() {
    if (sharpening) return;
    setSharpening(true);
    try {
      const res = await fetch("/api/ai/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt:
            "Rewrite this student bio so it is sharper, authentic, and fun. Keep it under 160 characters, reply with ONLY the rewritten bio.\n\nBio: " +
            bio,
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
        setBio(result.trim());
        toast({ kind: "success", title: "Bio sharpened ✨", description: "Groq polished your vibe statement." });
      }
    } catch {
      toast({ kind: "error", title: "Connection hiccup", description: "The AI stream dropped — try again." });
    } finally {
      setSharpening(false);
    }
  }

  function toggleGoing(id: string) {
    setRsvps((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div className="min-h-screen bg-slate-200/70 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <Navbar />

      <div className="mx-auto max-w-7xl px-4 pb-28 pt-6 lg:px-6 lg:pt-24">
        {/* ================= hero welcome ================= */}
        <section className="liquid-glass relative overflow-hidden p-6 sm:p-8">
          <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-violet-600/15 blur-3xl" />
          <div className="relative">
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-100 sm:text-4xl">
              Welcome to Your Space, <span className="bg-gradient-to-r from-cyan-400 to-violet-500 bg-clip-text text-transparent">Maya</span>
            </h1>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-zinc-400">
              Show off what you&apos;re building, keep your skills sharp, and keep your events moving — all in one place.
            </p>
            <button
              onClick={() => void sharpenBio()}
              disabled={sharpening}
              className="mt-5 inline-flex h-10 items-center gap-2 rounded-full border border-white/10 bg-zinc-900/50 px-5 text-sm font-medium text-zinc-300 transition hover:border-violet-500/40 hover:text-violet-300 disabled:opacity-50"
            >
              {sharpening ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              Sharpen Bio with Groq AI
            </button>
          </div>
        </section>

        {/* ================= 2-column layout ================= */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* ---------- LEFT: creations & skills ---------- */}
          <div className="space-y-6">
            {/* --- my projects & creations --- */}
            <section className="liquid-glass p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold tracking-tight text-zinc-100">My Projects &amp; Creations</h2>
                <button
                  onClick={() => toast({ kind: "info", title: "New project", description: "Project templates are coming soon — tell us what you're building!" })}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full bg-violet-600 px-4 text-xs font-semibold text-white transition hover:bg-violet-500 hover:shadow-[0_0_16px_rgba(139,92,246,0.35)]"
                >
                  <Plus size={14} />
                  New Project
                </button>
              </div>
              <div className="space-y-3">
                {PROJECTS.map((p) => (
                  <article key={p.id} className="rounded-xl border border-white/10 bg-zinc-900/40 p-4 transition-colors hover:border-violet-500/25">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-zinc-100">{p.title}</p>
                        <p className="mt-0.5 truncate text-xs text-zinc-400">{p.description}</p>
                      </div>
                      <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold", STATUS_STYLE[p.status])}>
                        {p.status}
                      </span>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between">
                      <Avatars stack={p.collaborators} />
                      <span className="text-[11px] text-zinc-500">
                        {p.collaborators.length === 1 ? "solo + 1" : `${p.collaborators.length} builders`}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            {/* --- skills --- */}
            <section className="liquid-glass p-5">
              <h2 className="text-lg font-semibold tracking-tight text-zinc-100">Skills</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {SKILLS.map((s) => (
                  <span key={s} className="rounded-full border border-violet-500/25 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-300">
                    {s}
                  </span>
                ))}
              </div>
              <p className="mt-5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Current passions</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {PASSIONS.map((tag) => (
                  <span key={tag} className="rounded-full border border-white/10 bg-zinc-900/40 px-3 py-1 text-xs text-zinc-400 transition-colors hover:border-cyan-500/40 hover:text-cyan-300">
                    {tag}
                  </span>
                ))}
              </div>
            </section>
          </div>

          {/* ---------- RIGHT: personal hub & events ---------- */}
          <aside className="space-y-4">
            <div className="lg:sticky lg:top-24 lg:space-y-4">
              {/* --- my motion identity --- */}
              <section className="liquid-glass overflow-hidden">
                <div className="h-16 bg-gradient-to-r from-violet-600/40 via-indigo-500/30 to-cyan-500/30" />
                <div className="px-4 pb-4">
                  <div className="-mt-8 flex items-end justify-between">
                    <div className="grid size-16 place-items-center rounded-full border-2 border-zinc-950 bg-gradient-to-br from-cyan-500 to-violet-600 text-lg font-bold text-white">
                      MC
                    </div>
                    <span className="mb-1 rounded-full border border-white/10 bg-zinc-900/60 px-2.5 py-1 text-[11px] font-medium text-zinc-300 backdrop-blur">
                      <Users size={11} className="mr-1 inline text-cyan-400" />
                      18 friends in motion
                    </span>
                  </div>
                  <div className="mt-2.5">
                    <p className="flex items-center gap-1.5 text-base font-semibold text-zinc-100">
                      Maya Chen
                      <BadgeCheck size={15} className="text-cyan-400" />
                    </p>
                    <p className="text-xs text-zinc-400">@mayacodes</p>
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-zinc-500">
                      <GraduationCap size={12} className="shrink-0" /> Westfield University · CS sophomore
                    </p>
                    <div className="mt-3 rounded-lg border border-white/10 bg-zinc-900/40 p-3">
                      <p className="flex items-start gap-1.5 text-xs leading-relaxed text-zinc-300">
                        <PencilLine size={11} className="mt-0.5 shrink-0 text-violet-400" />
                        {bio}
                      </p>
                    </div>
                  </div>
                </div>
              </section>

              {/* --- my events --- */}
              <section className="liquid-glass p-4">
                <h3 className="text-sm font-semibold text-zinc-100">My Events</h3>
                <p className="mt-0.5 text-[11px] text-zinc-500">Hosting or attending — your next few weeks</p>
                <div className="mt-3 space-y-2.5">
                  {MY_EVENTS.map((e) => {
                    const going = e.role === "Hosting" || rsvps[e.id] || false;
                    return (
                      <article key={e.id} className="rounded-xl border border-white/10 bg-zinc-900/40 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold leading-snug text-zinc-100">{e.title}</p>
                          <span
                            className={cn(
                              "shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider",
                              e.role === "Hosting"
                                ? "border-violet-500/30 bg-violet-500/10 text-violet-300"
                                : "border-cyan-500/30 bg-cyan-500/10 text-cyan-300"
                            )}
                          >
                            {e.role}
                          </span>
                        </div>
                        <div className="mt-1.5 space-y-0.5 text-[11px] text-zinc-400">
                          <p className="flex items-center gap-1.5">
                            <CalendarDays size={11} className="shrink-0 text-violet-400" /> {e.date} · {e.time}
                          </p>
                          <p className="flex items-center gap-1.5">
                            <MapPin size={11} className="shrink-0 text-rose-400" /> {e.venue}
                          </p>
                          <p className="flex items-center gap-1.5">
                            <Clock size={11} className="shrink-0 text-cyan-400" /> {e.going + (going && e.role === "Attending" ? 1 : 0)} going
                          </p>
                        </div>
                        {e.role === "Attending" && (
                          <button
                            onClick={() => toggleGoing(e.id)}
                            className={cn(
                              "mt-2.5 h-7 w-full rounded-full text-xs font-semibold transition-all duration-300",
                              going
                                ? "bg-emerald-500/20 text-emerald-300"
                                : "bg-violet-600 text-white hover:bg-violet-500 hover:shadow-[0_0_16px_rgba(139,92,246,0.35)]"
                            )}
                          >
                            {going ? "RSVP confirmed ✓" : "RSVP"}
                          </button>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
