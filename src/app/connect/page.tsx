"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import {
  BadgeCheck,
  CalendarDays,
  Clock,
  Compass,
  Eye,
  GraduationCap,
  MapPin,
  Sparkles,
  TrendingUp,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { Navbar } from "@/components/motion/navbar";
import { useToast } from "@/components/motion/toaster";
import { cn } from "@/lib/utils";

/* ============================== mock data ============================== */

interface MutualPerson {
  name: string;
  initials: string;
}

interface RequestCard {
  id: string;
  name: string;
  handle: string;
  school: string;
  mutualWith: MutualPerson[];
  initials: string;
}

interface SuggestionCard {
  id: string;
  name: string;
  handle: string;    school: string;
    bio: string;
    mutualWith: MutualPerson[];
    initials: string;
    gradient: string;
}

interface EventCard {
  id: string;
  title: string;
  host: string;
  venue: string;
  date: string;
  time: string;
  duration: string;
  description: string;
  attending: number;
  gradient: string;
}

const PENDING_REQUESTS: RequestCard[] = [
  {
    id: "req-1",
    name: "Ishita Rao",
    handle: "ishita.builds",
    school: "Northgate High · Junior",
    mutualWith: [
      { name: "Maya Chen", initials: "MC" },
      { name: "Arjun Mehta", initials: "AM" },
      { name: "Noah Kim", initials: "NK" },
      { name: "Dev Dhillon", initials: "DD" },
    ],
    initials: "IR",
  },
  {
    id: "req-2",
    name: "Daniel Park",
    handle: "dpark.codes",
    school: "Westfield University",
    mutualWith: [
      { name: "Maya Chen", initials: "MC" },
      { name: "Zoe Alvarez", initials: "ZA" },
    ],
    initials: "DP",
  },
];

const SUGGESTIONS: SuggestionCard[] = [
  {
    id: "s1",
    name: "Maya Chen",
    handle: "mayacodes",
    school: "Westfield University",
    bio: "CS sophomore. Ships hackathon projects and writes about them.",
    mutualWith: [
      { name: "Arjun Mehta", initials: "AM" },
      { name: "Zoe Alvarez", initials: "ZA" },
      { name: "Noah Kim", initials: "NK" },
    ],
    initials: "MC",
    gradient: "from-cyan-500/70 to-violet-600/70",
  },
  {
    id: "s2",
    name: "Arjun Mehta",
    handle: "arjun.builds",
    school: "Northgate High",
    bio: "Robotics captain. Line-follower builds at 3:47 AM.",
    mutualWith: [
      { name: "Maya Chen", initials: "MC" },
      { name: "Noah Kim", initials: "NK" },
      { name: "Dev Dhillon", initials: "DD" },
      { name: "Mia Okafor", initials: "MO" },
      { name: "Leo Martins", initials: "LM" },
    ],
    initials: "AM",
    gradient: "from-violet-500/70 to-fuchsia-500/60",
  },
  {
    id: "s3",
    name: "Zoe Alvarez",
    handle: "zoedesigns",
    school: "Lakeside College",
    bio: "Product design student. Dark mode maximalist.",
    mutualWith: [{ name: "Maya Chen", initials: "MC" }],
    initials: "ZA",
    gradient: "from-cyan-400/70 to-blue-600/60",
  },
  {
    id: "s4",
    name: "Noah Kim",
    handle: "noahlabs",
    school: "Westfield University",
    bio: "Drone intern. Teaches PCB design on weekends.",
    mutualWith: [
      { name: "Arjun Mehta", initials: "AM" },
      { name: "Maya Chen", initials: "MC" },
    ],
    initials: "NK",
    gradient: "from-indigo-500/70 to-cyan-500/60",
  },
  {
    id: "s5",
    name: "Mia Okafor",
    handle: "mia.makes",
    school: "Lakeside College",
    bio: "Robotics + art. Builds installations that move.",
    mutualWith: [
      { name: "Zoe Alvarez", initials: "ZA" },
      { name: "Arjun Mehta", initials: "AM" },
      { name: "Dev Dhillon", initials: "DD" },
    ],
    initials: "MO",
    gradient: "from-violet-500/70 to-cyan-500/60",
  },
  {
    id: "s6",
    name: "Dev Dhillon",
    handle: "devdhillon",
    school: "Northgate High",
    bio: "Cricket commissioner. Stats nerd, occasional bowler.",
    mutualWith: [
      { name: "Arjun Mehta", initials: "AM" },
      { name: "Mia Okafor", initials: "MO" },
      { name: "Ishita Rao", initials: "IR" },
      { name: "Maya Chen", initials: "MC" },
      { name: "Noah Kim", initials: "NK" },
      { name: "Leo Martins", initials: "LM" },
    ],
    initials: "DD",
    gradient: "from-blue-500/70 to-violet-600/60",
  },
  {
    id: "s7",
    name: "Sana Qureshi",
    handle: "sana.writes",
    school: "Westfield University",
    bio: "Journalism minor. Covers campus hackathons.",
    mutualWith: [],
    initials: "SQ",
    gradient: "from-cyan-500/70 to-indigo-500/60",
  },
  {
    id: "s8",
    name: "Leo Martins",
    handle: "leo.ml",
    school: "Northgate High",
    bio: "First-year ML enthusiast. Kaggle on the bus.",
    mutualWith: [
      { name: "Arjun Mehta", initials: "AM" },
      { name: "Dev Dhillon", initials: "DD" },
    ],
    initials: "LM",
    gradient: "from-violet-500/70 to-blue-500/60",
  },
];

const EVENTS: EventCard[] = [
  {
    id: "e1",
    title: "Northgate Robotics Fall Kickoff",
    host: "Northgate Robotics Club",
    venue: "Northgate Campus Auditorium",
    date: "Sat, Oct 3",
    time: "10:00 AM",
    duration: "4 hrs",
    description: "Build a line-follower in a weekend — kits provided, mentors on site.",
    attending: 42,
    gradient: "from-violet-600/50 via-indigo-500/40 to-cyan-500/40",
  },
  {
    id: "e2",
    title: "Intro to UI/UX: Portfolio Crit Night",
    host: "Motion Design Guild",
    venue: "Virtual / Room 402",
    date: "Wed, Oct 7",
    time: "6:30 PM",
    duration: "90 min",
    description: "Bring your portfolio, leave with three concrete fixes from senior students.",
    attending: 28,
    gradient: "from-cyan-500/50 via-sky-500/40 to-indigo-500/40",
  },
  {
    id: "e3",
    title: "Hackathon Warm-up: Team Forming",
    host: "Motion Weekly",
    venue: "Virtual",
    date: "Fri, Oct 9",
    time: "7:00 PM",
    duration: "2 hrs",
    description: "Pitch an idea or join one — moderated team-forming for HackathonSeason.",
    attending: 63,
    gradient: "from-indigo-500/50 via-violet-500/40 to-fuchsia-500/40",
  },
];

const GRADIENTS = [
  "from-violet-500/60 to-cyan-500/50",
  "from-cyan-500/60 to-indigo-500/50",
  "from-indigo-500/60 to-violet-500/50",
  "from-blue-500/60 to-violet-500/50",
];

/* ============================== helpers ============================== */

function Initials({ text, className }: { text: string; className?: string }) {
  return (
    <div
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-cyan-500 to-violet-600 font-bold text-white",
        className
      )}
    >
      {text}
    </div>
  );
}

/**
 * Overlapping mini avatars of the mutual people, with the count beside them.
 * Shows up to 3 faces + a "+N" overflow chip; hover any of it for the names.
 */
function MutualStack({ people }: { people: MutualPerson[] }) {
  const shown = people.slice(0, 3);
  const extra = people.length - shown.length;
  return (
    <span
      className="flex items-center gap-2"
      title={`Mutual with ${people.map((p) => p.name).join(", ")}`}
    >
      <span className="flex -space-x-1.5">
        {shown.map((p) => (
          <span
            key={p.initials}
            title={p.name}
            className="grid size-5 place-items-center rounded-full border border-zinc-950 bg-gradient-to-br from-cyan-500 to-violet-600 text-[7px] font-bold text-white"
          >
            {p.initials}
          </span>
        ))}
        {extra > 0 && (
          <span className="grid size-5 place-items-center rounded-full border border-zinc-950 bg-zinc-800 text-[7px] font-bold text-zinc-300">
            +{extra}
          </span>
        )}
      </span>
      <span className="text-[11px] font-medium text-cyan-300">
        {people.length} mutual {people.length === 1 ? "connection" : "connections"}
      </span>
    </span>
  );
}

/* ============================== page ============================== */

export default function ConnectPage() {
  const { toast } = useToast();
  const [requests, setRequests] = useState<RequestCard[]>(PENDING_REQUESTS);
  const [states, setStates] = useState<Record<string, "none" | "pending" | "connected">>({});
  const [rsvps, setRsvps] = useState<Record<string, boolean>>({});

  function accept(id: string) {
    const card = requests.find((r) => r.id === id);
    setRequests((prev) => prev.filter((r) => r.id !== id));
    if (card) setStates((p) => ({ ...p, [card.handle]: "connected" }));
    toast({ kind: "success", title: "Request accepted", description: card ? `${card.name} is now in your network.` : undefined });
  }

  function ignore(id: string) {
    setRequests((prev) => prev.filter((r) => r.id !== id));
  }

  function connect(handle: string) {
    setStates((prev) => ({ ...prev, [handle]: prev[handle] === "none" || !prev[handle] ? "pending" : prev[handle] }));
    toast({ kind: "info", title: "Request sent", description: `We'll ping you when @${handle} responds.` });
  }

  function toggleRsvp(id: string) {
    setRsvps((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const totalConnections = useMemo(
    () => 18 + Object.values(states).filter((s) => s === "connected").length,
    [states]
  );

  return (
    <div className="min-h-screen bg-slate-200/70 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <Navbar />

      <div className="mx-auto max-w-7xl px-4 pb-28 pt-6 lg:px-6 lg:pt-24">
        {/* header */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Connect</h1>
            <p className="mt-1 text-sm text-zinc-400">Grow your circle — requests, suggestions, and events.</p>
          </div>
          <span className="rounded-full border border-white/10 bg-zinc-950/60 px-3 py-1.5 text-xs text-zinc-400 backdrop-blur-xl">
            <Users size={12} className="mr-1.5 inline text-violet-400" />
            {totalConnections} connections
          </span>
        </div>

        {/* ================= 2-column layout ================= */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* ---------- LEFT: network hub ---------- */}
          <div className="space-y-6">
            {/* ---- connection requests ---- */}
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">
                Connection Requests
                {requests.length > 0 && (
                  <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-bold text-violet-300">
                    {requests.length}
                  </span>
                )}
              </h2>
              {requests.length === 0 ? (
                <div className="liquid-glass flex items-center gap-4 p-5">
                  <span className="grid size-11 shrink-0 place-items-center rounded-full border border-emerald-500/30 bg-emerald-500/10">
                    <BadgeCheck size={20} className="text-emerald-400" />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-zinc-200">No pending requests right now — your network is up to date!</p>
                    <p className="mt-0.5 text-xs text-zinc-400">Check recommendations below to grow your circle.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {requests.map((r) => (
                    <div key={r.id} className="liquid-glass flex items-center gap-4 p-4">
                      <Initials text={r.initials} className="size-11 text-sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-zinc-100">{r.name}</p>
                        <p className="flex items-center gap-1 truncate text-xs text-zinc-400">
                          <GraduationCap size={12} className="shrink-0" /> {r.school}
                        </p>
                        <MutualStack people={r.mutualWith} />
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          onClick={() => accept(r.id)}
                          className="h-8 rounded-full bg-violet-600 px-4 text-xs font-semibold text-white transition hover:bg-violet-500"
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => ignore(r.id)}
                          className="grid size-8 place-items-center rounded-full border border-white/10 bg-zinc-900/50 text-zinc-400 transition hover:border-rose-500/40 hover:text-rose-300"
                          aria-label={`Ignore request from ${r.name}`}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ---- up your motion ---- */}
            <section>
              <div className="mb-3">
                <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-zinc-100">
                  <TrendingUp size={18} className="text-violet-400" />
                  Up Your Motion
                </h2>
                <p className="mt-0.5 text-xs text-zinc-400">People you might want to connect with</p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {SUGGESTIONS.map((s) => {
                  const state = states[s.handle] ?? "none";
                  return (
                    <article key={s.id} className="liquid-glass overflow-hidden">
                      {/* cover banner */}
                      <div className={cn("h-14 w-full bg-gradient-to-br", s.gradient)} />
                      <div className="relative px-4 pb-4">
                        <Initials
                          text={s.initials}
                          className="absolute -top-6 size-12 border-2 border-zinc-950 text-sm"
                        />
                        <div className="pt-7">
                          <p className="truncate text-sm font-semibold text-zinc-100">{s.name}</p>
                          <p className="truncate text-xs text-zinc-400">@{s.handle}</p>
                          <p className="mt-1 flex items-center gap-1 truncate text-[11px] text-zinc-500">
                            <GraduationCap size={11} className="shrink-0" /> {s.school}
                          </p>
                          <p className="mt-1.5 line-clamp-2 min-h-8 text-xs leading-relaxed text-zinc-400">{s.bio}</p>
                          {s.mutualWith.length > 0 ? (
                            <p className="mt-2">
                              <MutualStack people={s.mutualWith} />
                            </p>
                          ) : (
                            <p className="mt-2 text-[11px] font-medium text-zinc-500">
                              New here — no mutuals yet
                            </p>
                          )}
                          <button
                            onClick={() => connect(s.handle)}
                            disabled={state === "pending" || state === "connected"}
                            className={cn(
                              "mt-3 h-7 rounded-full px-4 py-1.5 text-xs font-semibold transition-all duration-300",
                              state === "connected"
                                ? "bg-emerald-500/20 text-emerald-300"
                                : state === "pending"
                                  ? "bg-violet-500/15 text-violet-300"
                                  : "bg-violet-600 text-white hover:bg-violet-500 hover:shadow-[0_0_16px_rgba(139,92,246,0.35)]"
                            )}
                          >
                            {state === "connected" ? "Connected" : state === "pending" ? "Pending" : "Connect"}
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          </div>

          {/* ---------- RIGHT: recommendations & events ---------- */}
          <aside className="space-y-4">
            <div className="lg:sticky lg:top-24 lg:space-y-4">
              {/* network pulse */}
              <div className="liquid-glass p-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                  <Sparkles size={15} className="text-violet-400" />
                  Network Summary &amp; Growth
                </h3>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-white/10 bg-zinc-900/40 p-3">
                    <p className="text-xl font-bold text-zinc-100">{totalConnections}</p>
                    <p className="text-[11px] text-zinc-400">Connections</p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-zinc-900/40 p-3">
                    <p className="flex items-center gap-1 text-xl font-bold text-zinc-100">
                      87 <Eye size={13} className="text-cyan-400" />
                    </p>
                    <p className="text-[11px] text-zinc-400">Profile views / wk</p>
                  </div>
                </div>
                <div className="mt-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
                  <p className="flex items-start gap-1.5 text-xs leading-relaxed text-cyan-200">
                    <Sparkles size={12} className="mt-0.5 shrink-0 text-cyan-400" />
                    3 students from your school joined Motion this week.
                  </p>
                </div>
              </div>

              {/* events */}
              <div className="liquid-glass p-4">
                <h3 className="text-sm font-semibold text-zinc-100">Events You Might Be Interested In</h3>
                <p className="mt-0.5 text-[11px] text-zinc-500">Curated by your interests</p>
                <div className="mt-3 space-y-3">
                  {EVENTS.map((e) => {
                    const going = rsvps[e.id] ?? false;
                    return (
                      <article key={e.id} className="overflow-hidden rounded-xl border border-white/10 bg-zinc-900/40">
                        {/* poster placeholder */}
                        <div className={cn("relative h-20 bg-gradient-to-br", e.gradient)}>
                          <span className="absolute bottom-2 left-3 flex items-center gap-1 text-[10px] font-semibold text-white/90">
                            <Compass size={10} /> {e.host}
                          </span>
                        </div>
                        <div className="p-3">
                          <p className="text-sm font-semibold leading-snug text-zinc-100">{e.title}</p>
                          <p className="mt-1 flex items-center gap-1 text-[11px] text-zinc-400">
                            <MapPin size={11} className="shrink-0" /> {e.venue}
                          </p>
                          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-zinc-400">
                            <CalendarDays size={11} className="shrink-0" /> {e.date} · {e.time}
                            <Clock size={11} className="ml-1 shrink-0" /> {e.duration}
                          </p>
                          <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">{e.description}</p>
                          <div className="mt-2.5 flex items-center justify-between">
                            <span className="flex items-center gap-1 text-[11px] font-medium text-zinc-400">
                              <Users size={11} className={cn("text-violet-400", going && "text-emerald-400")} />
                              {e.attending + (going ? 1 : 0)} attending
                            </span>
                            <button
                              onClick={() => toggleRsvp(e.id)}
                              className={cn(
                                "h-7 rounded-full px-3.5 text-xs font-semibold transition-all duration-300",
                                going
                                  ? "bg-emerald-500/20 text-emerald-300"
                                  : "bg-violet-600 text-white hover:bg-violet-500 hover:shadow-[0_0_16px_rgba(139,92,246,0.35)]"
                              )}
                            >
                              {going ? "Going" : "RSVP"}
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
