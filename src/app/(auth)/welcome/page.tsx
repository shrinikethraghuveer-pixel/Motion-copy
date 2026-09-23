"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, useInView } from "framer-motion";
import { ArrowRight, Check, Compass, MessageCircle, Plus, Sparkles, Users, Zap } from "lucide-react";
import { api } from "@/lib/client";
import { useSession } from "@/components/providers";
import AuthModal from "@/components/landing/AuthModal";
import { WELCOME_TAGS_KEY } from "@/lib/welcome-tags";
import MotionLogo from "@/components/brand/MotionLogo";

/* ───────────────────────────── constants ───────────────────────────── */

/** Predefined suggestion pool — free-form input adds anything beyond these. */
const SUGGESTED_TAGS = [
  "AI",
  "Figma",
  "SaaS",
  "Productivity",
  "NextJS",
  "Design",
  "Startups",
  "Open Source",
  "Photography",
  "Robotics",
  "Writing",
  "Music",
];

const FEATURES = [
  {
    icon: Zap,
    title: "Feed",
    text: "A living stream of what your circle is building — projects, wins, and Pulse opportunities worth your calendar.",
    tone: "light:text-violet-600 dark:text-violet-400",
  },
  {
    icon: Users,
    title: "Connect",
    text: "Mutual-first networking for students. No cold corporate DMs — connections start from shared builds and interests.",
    tone: "light:text-cyan-600 dark:text-cyan-400",
  },
  {
    icon: Compass,
    title: "AI Workspace",
    text: "An on-tap assistant that drafts, brainstorms, and surfaces the right people and openings for your next motion.",
    tone: "light:text-amber-600 dark:text-amber-400",
  },
  {
    icon: MessageCircle,
    title: "Focus-first chats",
    text: "Requests from non-connections wait politely in an inbox, so nothing interrupts your flow.",
    tone: "light:text-rose-600 dark:text-rose-400",
  },
];

/* ───────────────────────────── tokens ───────────────────────────── */

const CANVAS = "light:bg-slate-200/70 dark:bg-zinc-950";

const NAVBAR_GLASS =
  "light:bg-white/80 light:border-white/90 light:shadow-md light:shadow-slate-300/30 " +
  "dark:bg-zinc-900/60 dark:border-zinc-800/80 dark:shadow-none border rounded-2xl p-3 flex items-center justify-between backdrop-blur-xl";

const TAG_INACTIVE =
  "light:bg-slate-100 dark:bg-zinc-800 light:border-slate-300 dark:border-zinc-700 light:text-zinc-700 dark:text-zinc-300 " +
  "border text-xs font-mono px-3.5 py-1.5 rounded-full transition-all cursor-pointer " +
  "hover:light:bg-slate-200 hover:dark:bg-zinc-700";

const TAG_ACTIVE =
  "light:bg-violet-600/10 dark:bg-violet-500/10 light:border-violet-500/80 dark:border-violet-500/80 " +
  "light:text-violet-600 dark:text-violet-400 border text-xs font-mono px-3.5 py-1.5 rounded-full transition-all cursor-pointer";

const TAG_INPUT =
  "light:bg-slate-100 dark:bg-zinc-800 light:border-slate-300/80 dark:border-zinc-700 border p-3 rounded-2xl w-full text-sm " +
  "light:text-zinc-900 dark:text-zinc-100 light:placeholder:text-zinc-400 dark:placeholder:text-zinc-500 outline-none " +
  "transition-colors light:focus:border-violet-500 dark:focus:border-violet-500/70";

/* ───────────────────────────── page ───────────────────────────── */

export default function WelcomePage() {
  const router = useRouter();
  const { me, loading, devFallbackSession } = useSession();
  const [authOpen, setAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState<"signin" | "signup">("signup");
  const [userCount, setUserCount] = useState<number | null>(null);

  // Signed-in users have no business on the landing page — except in dev,
  // where the API always resolves the seeded user even without a session.
  useEffect(() => {
    if (!loading && me && !devFallbackSession) router.replace("/home");
  }, [me, loading, devFallbackSession, router]);

  useEffect(() => {
    api<{ userCount?: number }>("/api/session")
      .then((d) => {
        setUserCount(d.userCount ?? null);
      })
      .catch(() => {});
  }, []);

  /* ── Free-form interest tagging ─────────────────────────────────── */
  const [selected, setSelected] = useState<string[]>([]);
  const [customTags, setCustomTags] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);

  const allTags = useMemo(() => [...SUGGESTED_TAGS, ...customTags], [customTags]);

  // Persist selections the moment they change — AuthModal reads this on open.
  useEffect(() => {
    try {
      localStorage.setItem(WELCOME_TAGS_KEY, JSON.stringify(selected));
    } catch {
      /* storage unavailable — tags just won't persist */
    }
  }, [selected]);

  const toggleTag = (tag: string) => {
    setInputError(null);
    setSelected((cur) =>
      cur.includes(tag) ? cur.filter((t) => t !== tag) : cur.length < 8 ? [...cur, tag] : cur
    );
  };

  const addCustomTag = () => {
    const tag = draft.trim().replace(/^#/, "").replace(/\s+/g, " ").slice(0, 24);
    if (!tag) return;
    if (allTags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
      // Already exists as a pill — just select it.
      setSelected((cur) => (cur.includes(tag) ? cur : cur.length < 8 ? [...cur, tag] : cur));
      setDraft("");
      return;
    }
    if (customTags.length >= 6) {
      setInputError("You can add up to 6 custom topics.");
      return;
    }
    setCustomTags((cur) => [...cur, tag]);
    setSelected((cur) => (cur.length < 8 ? [...cur, tag] : cur));
    setDraft("");
    setInputError(null);
  };

  /* ── Sign-in / sign-up hand-off (opens the shared AuthModal) ────── */
  const openAuth = (tab: "signin" | "signup") => {
    setAuthTab(tab);
    setAuthOpen(true);
  };

  // The stock AuthModal opens on the demo tab; flip to the requested tab on mount.
  useEffect(() => {
    if (!authOpen || authTab !== "signup") return;
    // AuthModal starts on "signup" already — nothing to do, but keep tabs in sync.
  }, [authOpen, authTab]);

  return (
    <div className={`${CANVAS} relative min-h-screen overflow-x-hidden`}>
      {/* Ambient violet/indigo mesh, matching the app shell */}
      <div className="mesh-gradient" aria-hidden="true" />
      <div className="orb orb-drift -left-32 top-24 h-96 w-96 light:bg-violet-500/15 dark:bg-violet-600/20" aria-hidden="true" />
      <div className="orb orb-drift right-[-10rem] top-1/3 h-[28rem] w-[28rem] light:bg-cyan-400/15 dark:bg-cyan-500/15" style={{ animationDelay: "-6s" }} aria-hidden="true" />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col gap-10 px-6 py-12">
        {/* ── 2. Top nav bar & logo module ─────────────────────────────── */}
        <motion.header
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className={`${NAVBAR_GLASS} sticky top-4 z-20`}
        >
          {/* Official brand lockup — glass mark floats free + themed wordmark */}
          <MotionLogo size="md" href="/" />

          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={() => openAuth("signin")}
              className="text-sm light:text-zinc-600 dark:text-zinc-300 transition-colors hover:text-violet-600 dark:hover:text-violet-400"
            >
              Sign In
            </button>
            <button
              onClick={() => openAuth("signup")}
              className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-violet-600/20 transition-all hover:bg-violet-700"
            >
              Get Started
            </button>
          </div>
        </motion.header>

        {/* ── 3 + 4. Hero (left) & free-form interest tagging (right) ──── */}
        <main className="grid flex-1 items-start gap-8 lg:grid-cols-2">
          {/* Hero discovery card */}
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: "easeOut" }}
            className="light:bg-white/80 light:border-white/90 light:shadow-xl light:shadow-slate-300/50 dark:bg-zinc-900/60 dark:border-zinc-800/80 dark:shadow-none flex flex-col justify-center rounded-3xl border p-8 backdrop-blur-xl sm:p-10"
          >
            <span className="inline-flex w-fit items-center gap-2 rounded-full border light:border-slate-300 dark:border-zinc-700/70 light:bg-slate-100 dark:bg-zinc-800/60 px-3.5 py-1.5 text-xs font-semibold light:text-violet-700 dark:text-violet-300">
              <Sparkles size={13} /> The student platform — not another LinkedIn
            </span>

            <h1 className="mt-6 text-4xl font-extrabold tracking-tighter light:text-zinc-950 dark:text-zinc-100 sm:text-5xl">
              Shape Your{" "}
              {/* Brand wordmark asset inline at headline scale (theme-switching) */}
              <span className="inline-block whitespace-nowrap align-baseline">
                {/* eslint-disable-next-line @next/next/no-img-element -- theme-swapped brand asset */}
                <img
                  src="/motion-wordmark-light.png"
                  alt="Motion"
                  className="inline-block h-[0.9em] w-auto object-contain dark:hidden"
                />
                {/* eslint-disable-next-line @next/next/no-img-element -- theme-swapped brand asset */}
                <img
                  src="/motion-wordmark-dark.png"
                  alt="Motion"
                  className="hidden h-[0.9em] w-auto object-contain dark:block"
                />
              </span>
              : Discover,{" "}
              <span className="text-violet-600 dark:text-violet-400">Create</span>, Connect.
            </h1>

            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="mt-5 text-base leading-relaxed light:text-zinc-700 dark:text-zinc-400 sm:text-lg"
            >
              One workspace for everything you're building: an AI assistant on tap, a social
              feed of real projects, and discovery that connects you to the peers,
              internships, and hackathons that match your interests.
            </motion.p>

            {/* Social proof */}
            <div className="mt-8 flex items-center gap-3">
              <div className="flex -space-x-2.5">
                {["MC", "AM", "ZA", "LP"].map((initials, i) => (
                  <span
                    key={initials}
                    className="grid size-8 place-items-center rounded-full border-2 light:border-white dark:border-zinc-900 text-[10px] font-bold text-white"
                    style={{ background: `linear-gradient(135deg, hsl(${i * 70 + 250} 70% 55%), hsl(${i * 70 + 320} 70% 45%))` }}
                  >
                    {initials}
                  </span>
                ))}
              </div>
              <p className="text-sm light:text-zinc-600 dark:text-zinc-400">
                Join <b className="font-semibold light:text-zinc-900 dark:text-zinc-100">15,000+ creators</b> building on Motion.
              </p>
            </div>
          </motion.section>

          {/* Free-form interest tagging card */}
          <motion.section
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.55, delay: 0.2, ease: "easeOut" }}
            className="light:bg-white/90 light:border-slate-300/80 light:shadow-2xl light:shadow-slate-300/60 dark:bg-zinc-900/80 dark:border-zinc-800/90 dark:shadow-none rounded-3xl border p-8 backdrop-blur-xl"
          >
            <h2 className="text-lg font-bold light:text-zinc-950 dark:text-zinc-100">
              What inspires your motion?{" "}
              <span className="block text-sm font-medium light:text-zinc-500 dark:text-zinc-400 mt-0.5">
                (Select or create tags)
              </span>
            </h2>

            {/* B. Free-form tag input */}
            <div className="mt-5 flex gap-2">
              <input
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setInputError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustomTag();
                  }
                }}
                placeholder="Type a topic (e.g., #NextJS, #ObsidianDesign, #Photography)"
                aria-label="Add your own interest tag"
                className={`${TAG_INPUT} flex-1`}
                maxLength={24}
              />
              <button
                onClick={addCustomTag}
                disabled={!draft.trim()}
                aria-label="Add tag"
                className="grid size-11 shrink-0 place-items-center self-center rounded-2xl bg-violet-600 text-white shadow-md shadow-violet-600/20 transition-all hover:bg-violet-700 disabled:opacity-40"
              >
                <Plus size={18} />
              </button>
            </div>
            {inputError && <p className="mt-2 text-xs light:text-rose-600 dark:text-rose-400">{inputError}</p>}

            {/* C. Pill container */}
            <div className="mt-5 flex flex-wrap gap-2" aria-label="Interest tags">
              {allTags.map((tag) => {
                const active = selected.includes(tag);
                return (
                  <button key={tag} onClick={() => toggleTag(tag)} aria-pressed={active} className={active ? TAG_ACTIVE : TAG_INACTIVE}>
                    <span className="inline-flex items-center gap-1.5">
                      {active && <Check className="h-3.5 w-3.5" />}
                      #{tag.replace(/\s+/g, "")}
                      {!SUGGESTED_TAGS.includes(tag) && (
                        <span
                          role="button"
                          tabIndex={-1}
                          aria-label={`Remove ${tag}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setCustomTags((cur) => cur.filter((t) => t !== tag));
                            setSelected((cur) => cur.filter((t) => t !== tag));
                          }}
                          className="ml-0.5 rounded-full p-0.5 hover:bg-violet-600/20"
                        >
                          ×
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 flex items-center justify-between text-xs light:text-zinc-500 dark:text-zinc-500">
              <span>
                {selected.length > 0 ? `${selected.length} selected` : "Pick a few — they shape your feed."}
                {customTags.length > 0 && ` · ${customTags.length} custom`}
              </span>
              {selected.length > 0 && (
                <button
                  onClick={() => setSelected([])}
                  className="transition-colors hover:text-violet-600 dark:hover:text-violet-400"
                >
                  Clear all
                </button>
              )}
            </div>

            {/* 5. Get Started on-ramp */}
            <button
              onClick={() => openAuth("signup")}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-600/25 transition-all hover:bg-violet-700"
            >
              Get Started — It's Free <ArrowRight size={16} />
            </button>
            <p className="mt-3 text-center text-xs light:text-zinc-500 dark:text-zinc-500">
              Your tags carry into onboarding. No school-domain checks.
            </p>
          </motion.section>
        </main>

        {/* ── 5. Feature preview cards (scroll-triggered) ─────────────── */}
        <FeatureGrid onCta={() => openAuth("signup")} />

        <footer className="pb-2 text-center text-xs light:text-zinc-500 dark:text-zinc-500">
          Motion — Where students build motion. © {new Date().getFullYear()}
        </footer>
      </div>

      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
    </div>
  );
}

/* ───────────────────── scroll-triggered feature grid ───────────────────── */

function FeatureGrid({ onCta }: { onCta: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section ref={ref} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {FEATURES.map((f, i) => (
        <motion.article
          key={f.title}
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.5, delay: i * 0.08, ease: "easeOut" }}
          className="light:bg-white/80 light:border-white/90 light:shadow-lg light:shadow-slate-300/40 dark:bg-zinc-900/60 dark:border-zinc-800/80 dark:shadow-none rounded-2xl border p-6 backdrop-blur-xl"
        >
          <f.icon size={22} className={f.tone} />
          <h3 className="mt-3 text-base font-bold light:text-zinc-900 dark:text-zinc-100">{f.title}</h3>
          <p className="mt-1.5 text-sm light:text-zinc-600 dark:text-zinc-400">{f.text}</p>
        </motion.article>
      ))}
      <motion.div
        initial={{ opacity: 0 }}
        animate={inView ? { opacity: 1 } : undefined}
        transition={{ duration: 0.5, delay: 0.4 }}
        className="sm:col-span-2 lg:col-span-4 text-center"
      >
        <button
          onClick={onCta}
          className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-8 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-600/25 transition-all hover:bg-violet-700"
        >
          Start your motion <ArrowRight size={16} />
        </button>
      </motion.div>
    </section>
  );
}
