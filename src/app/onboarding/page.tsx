"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Loader2, Plus } from "lucide-react";
import { api } from "@/lib/client";
import { isUsernameAvailable } from "@/lib/supabase/auth";
import type { PublicUser } from "@/lib/schema";
import { GRADE_OPTIONS, GOAL_OPTIONS_MULTI, DISCOVERY_SOURCES } from "@/lib/schema";
import { readWelcomeTags, clearWelcomeTags } from "@/lib/welcome-tags";
import MotionLogo from "@/components/brand/MotionLogo";

/* ───────────────────────────── constants ───────────────────────────── */

const STEPS = ["Stage", "Interests", "Goals", "Discovery"] as const;

const SUGGESTED_INTERESTS = [
  "Coding",
  "AI",
  "UI/UX",
  "Robotics",
  "Music",
  "Video Editing",
  "Writing",
  "Photography",
  "Startups",
  "Gaming",
  "Design",
  "Entrepreneurship",
];

/* ───────────────────────────── obsidian tokens ───────────────────────────── */

const CANVAS = "light:bg-slate-200/70 dark:bg-zinc-950";

const GLASS_CARD =
  "rounded-3xl border light:border-slate-300/80 dark:border-zinc-800/80 light:bg-white/90 dark:bg-zinc-900/80 " +
  "backdrop-blur-xl light:shadow-2xl light:shadow-slate-300/60 dark:shadow-none";

const INPUT =
  "rounded-2xl border light:border-slate-300/80 dark:border-zinc-700 light:bg-slate-100 dark:bg-zinc-800 " +
  "px-4 py-3 text-sm light:text-zinc-900 dark:text-zinc-100 outline-none transition-colors " +
  "light:placeholder:text-zinc-400 dark:placeholder:text-zinc-500 " +
  "light:focus:border-violet-500 dark:focus:border-violet-500/70";

const OPTION_TILE = (active: boolean) =>
  `rounded-2xl border px-4 py-3 text-left text-sm transition-all ${active
    ? "border-violet-500/80 bg-violet-600/10 text-violet-700 dark:text-violet-300 shadow-sm shadow-violet-600/20"
    : "light:border-slate-300/70 dark:border-zinc-700 light:bg-slate-100/80 dark:bg-zinc-800/60 light:text-zinc-700 dark:text-zinc-300 hover:border-violet-500/40"}`;

const TAG_INACTIVE =
  "light:bg-slate-100 dark:bg-zinc-800 light:border-slate-300 dark:border-zinc-700 light:text-zinc-700 dark:text-zinc-300 " +
  "border text-xs font-mono px-3.5 py-1.5 rounded-full transition-all cursor-pointer " +
  "hover:light:bg-slate-200 hover:dark:bg-zinc-700";

const TAG_ACTIVE =
  "light:bg-violet-600/10 dark:bg-violet-500/10 border border-violet-500/80 text-violet-600 dark:text-violet-400 " +
  "text-xs font-mono px-3.5 py-1.5 rounded-full transition-all cursor-pointer";

/* ───────────────────────────── page ───────────────────────────── */

export default function OnboardingPage() {
  const router = useRouter();
  const [me, setMe] = useState<PublicUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<"idle" | "checking" | "available" | "taken" | "error">("idle");

  // Step 1 — stage + age
  const [grade, setGrade] = useState<string | null>(null);
  const [age, setAge] = useState("");
  const ageNum = Number(age);
  const ageValid = Number.isInteger(ageNum) && ageNum >= 12 && ageNum <= 105;

  // Step 2 — free-form interests
  const [interests, setInterests] = useState<string[]>([]);
  const [customTags, setCustomTags] = useState<string[]>([]);
  const [draft, setDraft] = useState("");

  // Steps 3 & 4 — multi-select goals, discovery source
  const [goals, setGoals] = useState<string[]>([]);
  const [source, setSource] = useState<string | null>(null);

  const allTags = useMemo(() => [...SUGGESTED_INTERESTS, ...customTags], [customTags]);

  // Session + welcome-tag prefill.
  useEffect(() => {
    api<{ user: PublicUser | null }>("/api/session")
      .then((d) => {
        if (!d.user) {
          router.replace("/welcome");
          return;
        }
        setMe(d.user);
        setUsername(d.user.handle ?? "");
        setInterests(readWelcomeTags()); // interests picked on /welcome carry in
        setChecking(false);
      })
      .catch(() => router.replace("/welcome"));
  }, [router]);

  useEffect(() => {
    const normalized = username.trim().replace(/^@+/, "").toLowerCase();
    if (!/^[a-z0-9_.]{3,20}$/.test(normalized)) {
      setUsernameStatus("idle");
      return;
    }
    setUsernameStatus("checking");
    let active = true;
    const timer = window.setTimeout(() => {
      isUsernameAvailable(normalized)
        .then((available) => { if (active) setUsernameStatus(available ? "available" : "taken"); })
        .catch(() => { if (active) setUsernameStatus("error"); });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [username]);

  const addCustomTag = () => {
    const tag = draft.trim().replace(/^#/, "").replace(/\s+/g, " ").slice(0, 24);
    if (!tag) return;
    if (allTags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
      setInterests((cur) => (cur.includes(tag) ? cur : [...cur, tag]));
      setDraft("");
      return;
    }
    setCustomTags((cur) => [...cur, tag]);
    setInterests((cur) => (cur.includes(tag) ? cur : [...cur, tag]));
    setDraft("");
  };

  /** Functional updater — safe under React 18 batching (no stale-closure races). */
  const toggle = (setList: React.Dispatch<React.SetStateAction<string[]>>, tag: string) => {
    setList((cur) => (cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag]));
  };

  /** Persist everything; skipping fills sensible defaults and still marks onboarded. */
  async function finalize(skip: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({
          // Even on skip, persist whatever the user already answered.
          grade: grade ?? "high",
          username: username.trim().replace(/^@+/, "").toLowerCase(),
          age: ageValid ? ageNum : me?.age ?? 16,
          skills: interests,
          goals: goals.length ? goals : skip ? ["Find collaborators"] : undefined,
          discoverySource: source,
          completeOnboarding: true,
        }),
      });
      clearWelcomeTags();
      // Signed-in hand-off: full navigation so every server component re-reads.
      window.location.assign("/home");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your answers");
      setBusy(false);
    }
  }

  const canNext =
    (step === 0 && !!grade && ageValid && usernameStatus === "available") ||
    (step === 1 && interests.length > 0) ||
    step === 2 ||
    step === 3;

  if (checking) {
    return (
      <div className={`${CANVAS} grid min-h-screen place-items-center`}>
        <Loader2 size={22} className="animate-spin text-violet-500" />
      </div>
    );
  }

  return (
    <div className={`${CANVAS} relative min-h-screen overflow-x-hidden`}>
      <div className="mesh-gradient" aria-hidden="true" />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-2xl flex-col px-6 pb-10 pt-8">
        {/* ── Header: brand + 4-step indicator + handle ─────────────────── */}
        <header className="flex flex-col gap-5">
          <div className="flex items-center justify-between">
            <MotionLogo size="sm" href="/" />
            {me && (
              <span className="font-mono text-xs light:text-zinc-500 dark:text-zinc-500">@{me.handle}</span>
            )}
          </div>

          {/* 1. Stage → 2. Interests → 3. Goals → 4. Discovery */}
          <ol className="flex items-center gap-1.5" aria-label="Onboarding progress">
            {STEPS.map((label, i) => {
              const done = i < step;
              const active = i === step;
              return (
                <li key={label} className="flex flex-1 items-center gap-1.5">
                  <button
                    onClick={() => i < step && setStep(i)}
                    disabled={i > step}
                    className="flex items-center gap-1.5 disabled:cursor-default"
                  >
                    <span
                      className={`grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-bold transition-all ${
                        active
                          ? "bg-violet-600 text-white shadow-md shadow-violet-600/30"
                          : done
                            ? "bg-violet-600/15 text-violet-600 dark:text-violet-400"
                            : "border light:border-slate-300 dark:border-zinc-700 light:text-zinc-400 dark:text-zinc-600"
                      }`}
                    >
                      {done ? <Check size={12} /> : i + 1}
                    </span>
                    <span
                      className={`hidden text-xs font-semibold sm:block ${
                        active
                          ? "light:text-zinc-950 dark:text-zinc-100"
                          : done
                            ? "light:text-zinc-600 dark:text-zinc-400"
                            : "light:text-zinc-400 dark:text-zinc-600"
                      }`}
                    >
                      {label}
                    </span>
                  </button>
                  {i < STEPS.length - 1 && (
                    <span
                      className={`h-px flex-1 transition-colors ${done ? "bg-violet-500/50" : "light:bg-slate-300 dark:bg-zinc-800"}`}
                      aria-hidden="true"
                    />
                  )}
                </li>
              );
            })}
          </ol>
        </header>

        {/* ── Step content ──────────────────────────────────────────────── */}
        <main className="mt-8 flex-1">
          {/* Enter-only animation: no AnimatePresence/exit, so a throttled or
              backgrounded tab can never freeze between steps. */}
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
              {/* ── STEP 1 · Academic / Life Stage ── */}
              {step === 0 && (
                <section className={`${GLASS_CARD} p-7`}>
                  <h1 className="text-xl font-bold light:text-zinc-950 dark:text-zinc-100">
                    What stage are you at?
                  </h1>
                  <p className="mt-1 text-sm light:text-zinc-600 dark:text-zinc-400">
                    Choose your handle and tell us a little about yourself.
                  </p>

                  <div className="mt-5">
                    <label htmlFor="username" className="text-xs font-semibold light:text-zinc-500 dark:text-zinc-500">
                      Username
                    </label>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="text-sm text-zinc-500">@</span>
                      <input
                        id="username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value.replace(/^@+/, "").toLowerCase())}
                        autoComplete="username"
                        maxLength={20}
                        className={`${INPUT} flex-1`}
                      />
                    </div>
                    <p className={`mt-1.5 text-xs ${usernameStatus === "available" ? "text-emerald-500" : usernameStatus === "taken" || usernameStatus === "error" ? "text-rose-500" : "light:text-zinc-500 dark:text-zinc-500"}`}>
                      {usernameStatus === "checking" ? "Checking availability…" : usernameStatus === "available" ? "Username is available." : usernameStatus === "taken" ? "That username is already taken." : usernameStatus === "error" ? "Could not check availability. Try again." : "Use 3–20 letters, numbers, dots, or underscores."}
                    </p>
                  </div>

                  <div className="mt-5 space-y-2">
                    {GRADE_OPTIONS.map((g) => (
                      <button
                        key={g.key}
                        onClick={() => setGrade(g.key)}
                        className={`flex w-full items-center justify-between ${OPTION_TILE(grade === g.key)}`}
                      >
                        <span>
                          <span className="block font-semibold">{g.label}</span>
                          <span className="text-xs opacity-70">{g.hint}</span>
                        </span>
                        {grade === g.key && <Check size={16} className="text-violet-500" />}
                      </button>
                    ))}
                  </div>

                  <div className="mt-5">
                    <label htmlFor="age" className="text-xs font-semibold light:text-zinc-500 dark:text-zinc-500">
                      Your age
                    </label>
                    <input
                      id="age"
                      value={age}
                      onChange={(e) => setAge(e.target.value.replace(/\D/g, "").slice(0, 3))}
                      inputMode="numeric"
                      placeholder="16"
                      className={`${INPUT} mt-1.5 w-32`}
                    />
                    {age !== "" && !ageValid && (
                      <p className="mt-1.5 text-xs light:text-rose-600 dark:text-rose-400">
                        Enter an age between 12 and 105.
                      </p>
                    )}
                  </div>
                </section>
              )}

              {/* ── STEP 2 · Free-form interests ── */}
              {step === 1 && (
                <section className={`${GLASS_CARD} p-7`}>
                  <h1 className="text-xl font-bold light:text-zinc-950 dark:text-zinc-100">
                    What are you into?
                  </h1>
                  <p className="mt-1 text-sm light:text-zinc-600 dark:text-zinc-400">
                    Select as many as you like — or create your own.
                  </p>

                  <div className="mt-5 flex gap-2">
                    <input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addCustomTag();
                        }
                      }}
                      placeholder="Type any topic (e.g. #Astrophotography)"
                      aria-label="Add a custom interest"
                      maxLength={24}
                      className={`${INPUT} flex-1`}
                    />
                    <button
                      onClick={addCustomTag}
                      disabled={!draft.trim()}
                      aria-label="Add interest"
                      className="grid size-11 shrink-0 place-items-center self-center rounded-2xl bg-violet-600 text-white shadow-md shadow-violet-600/20 transition-all hover:bg-violet-700 disabled:opacity-40"
                    >
                      <Plus size={18} />
                    </button>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-2" aria-label="Interests">
                    {allTags.map((tag) => {
                      const active = interests.includes(tag);
                      return (
                        <button
                          key={tag}
                          onClick={() => toggle(setInterests, tag)}
                          aria-pressed={active}
                          className={active ? TAG_ACTIVE : TAG_INACTIVE}
                        >
                          <span className="inline-flex items-center gap-1.5">
                            {active && <Check className="h-3.5 w-3.5" />}#{tag.replace(/\s+/g, "")}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <p className="mt-4 text-xs light:text-zinc-500 dark:text-zinc-500">
                    {interests.length > 0 ? `${interests.length} selected` : "Pick at least one — they seed your feed."}
                  </p>
                </section>
              )}

              {/* ── STEP 3 · Multi-select goals ── */}
              {step === 2 && (
                <section className={`${GLASS_CARD} p-7`}>
                  <h1 className="text-xl font-bold light:text-zinc-950 dark:text-zinc-100">
                    What brings you to Motion?
                  </h1>
                  <p className="mt-1 text-sm light:text-zinc-600 dark:text-zinc-400">
                    Choose all that apply — you can change these anytime.
                  </p>

                  <div className="mt-5 grid gap-2 sm:grid-cols-2">
                    {GOAL_OPTIONS_MULTI.map((g) => {
                      const active = goals.includes(g);
                      return (
                        <button
                          key={g}
                          onClick={() => toggle(setGoals, g)}
                          aria-pressed={active}
                          className={`flex items-center justify-between ${OPTION_TILE(active)}`}
                        >
                          {g}
                          {active && <Check size={16} className="shrink-0 text-violet-500" />}
                        </button>
                      );
                    })}
                  </div>

                  <p className="mt-4 text-xs light:text-zinc-500 dark:text-zinc-500">
                    {goals.length > 0 ? `${goals.length} selected` : "Pick one or more."}
                  </p>
                </section>
              )}

              {/* ── STEP 4 · Analytics & discovery ── */}
              {step === 3 && (
                <section className={`${GLASS_CARD} p-7`}>
                  <h1 className="text-xl font-bold light:text-zinc-950 dark:text-zinc-100">
                    Where did you hear about Motion?
                  </h1>
                  <p className="mt-1 text-sm light:text-zinc-600 dark:text-zinc-400">
                    Helps us know what&apos;s working — optional.
                  </p>

                  <div className="mt-5 grid gap-2 sm:grid-cols-2">
                    {DISCOVERY_SOURCES.map((s) => {
                      const active = source === s;
                      return (
                        <button
                          key={s}
                          onClick={() => setSource(active ? null : s)}
                          aria-pressed={active}
                          className={`flex items-center justify-between ${OPTION_TILE(active)}`}
                        >
                          {s}
                          {active && <Check size={16} className="shrink-0 text-violet-500" />}
                        </button>
                      );
                    })}
                  </div>              </section>
            )}
          </motion.div>

          {error && <p className="mt-4 text-sm light:text-rose-600 dark:text-rose-400">{error}</p>}
        </main>

        {/* ── Footer: Back · Skip (discrete) · Next/Finish ────────────────── */}
        <footer className="mt-8 flex items-center justify-between">
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            className={`flex items-center gap-1.5 text-sm light:text-zinc-500 dark:text-zinc-500 transition hover:light:text-zinc-900 dark:hover:text-zinc-200 ${step === 0 ? "invisible" : ""}`}
          >
            <ArrowLeft size={15} /> Back
          </button>

          <div className="flex items-center gap-4">
            {/* Discrete Skip — no pill, no bubble, per spec */}
            <button
              onClick={() => finalize(true)}
              disabled={busy}
              className="text-xs light:text-zinc-500 dark:text-zinc-500 transition-colors hover:light:text-zinc-300 dark:hover:text-zinc-300 disabled:opacity-40"
            >
              Skip
            </button>
            {step < 3 ? (
              <button
                onClick={() => {
                  setError(null);
                  if (step === 0 && (!grade || !ageValid || usernameStatus !== "available")) {
                    setError("Choose a stage, enter a valid age, and use an available username.");
                    return;
                  }
                  if (step === 1 && interests.length === 0) {
                    setError("Pick at least one interest.");
                    return;
                  }
                  setStep((s) => s + 1);
                }}
                disabled={!canNext}
                className="flex items-center gap-2 rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-600/25 transition-all hover:bg-violet-700 disabled:opacity-40"
              >
                Next <ArrowRight size={15} />
              </button>
            ) : (
              <button
                onClick={() => finalize(false)}
                disabled={busy}
                className="flex items-center gap-2 rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-600/25 transition-all hover:bg-violet-700 disabled:opacity-40"
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                Enter Motion
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
