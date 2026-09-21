"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import RibbonM from "@/components/motion/ribbon-m";
import { Button } from "@/components/ui/shadcn/button";
import {
  getCurrentUserSession,
  isUsernameAvailable,
  saveOnboarding,
  type OnboardingData,
  type SessionUser,
} from "@/lib/supabase/auth";
import { cn } from "@/lib/utils";

const INTEREST_GROUPS: Array<{ label: string; items: string[] }> = [
  {
    label: "Career & Tech",
    items: ["Coding", "AI Prompting", "Game Dev", "UI/UX Design", "Entrepreneurship", "Content Creation"],
  },
  {
    label: "Education & Academics",
    items: ["STEM", "Humanities", "Study Hacks", "Hackathons", "College Prep"],
  },
  {
    label: "Sports & Fitness",
    items: ["Basketball", "Football", "Skateboarding", "Fitness/Gym", "Esports/Gaming"],
  },
];

const GOALS = ["Build Projects", "Find Collaborators", "Learn & Explore", "Just Hanging Out"];
const FEED_VIBES = ["Tech & Hacks", "Creative & Media", "Sports & Energy", "Balanced Mix"];

export default function OnboardingPage() {
  const router = useRouter();
  const [session, setSession] = useState<SessionUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [step, setStep] = useState(0);
  const [age, setAge] = useState("");
  const [interests, setInterests] = useState<string[]>([]);
  const [goal, setGoal] = useState("");
  const [vibe, setVibe] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ageNum = Number(age);
  const ageValid = Number.isInteger(ageNum) && ageNum >= 12 && ageNum <= 22;

  useEffect(() => {
    void getCurrentUserSession().then((s) => {
      if (!s) {
        router.replace("/login?next=/onboarding");
        return;
      }
      setSession(s);
      setChecking(false);
    });
  }, [router]);

  function toggleInterest(tag: string) {
    setInterests((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  function next() {
    setError(null);
    if (step === 0 && !ageValid) {
      setError("Enter an age between 12 and 22.");
      return;
    }
    if (step === 1 && (interests.length < 3 || interests.length > 6)) {
      setError("Pick 3 to 6 interests.");
      return;
    }
    setStep((s) => s + 1);
  }

  async function submit() {
    if (!goal) {
      setError("Pick what brings you to Motion.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await saveOnboarding({
      age: ageNum,
      interests,
      goal,
      feedVibe: vibe || "Balanced Mix",
    });
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    router.push("/home");
  }

  if (checking) {
    return (
      <div className="grid min-h-screen place-items-center bg-zinc-950 text-zinc-500">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  const canContinue =
    (step === 0 && ageValid) ||
    (step === 1 && interests.length >= 3 && interests.length <= 6) ||
    step === 2;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex min-h-screen max-w-xl flex-col px-6 pb-10 pt-12">
        {/* brand row */}
        <div className="flex items-center gap-3">
          <RibbonM size={36} />
          <div>
            <p className="font-display text-lg font-bold">Welcome to Motion</p>
            <p className="text-xs text-zinc-500">
              {session?.profile?.username ? `@${session.profile.username}` : session?.email}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === step ? "w-6 bg-violet-500" : "w-1.5 bg-zinc-700"
                )}
              />
            ))}
          </div>
        </div>

        <div className="mt-10 flex-1">
          {/* ---- step 1: age ---- */}
          {step === 0 && (
            <div className="space-y-5">
              <div>
                <h1 className="font-display text-2xl font-bold">How old are you?</h1>
                <p className="mt-1 text-sm text-zinc-500">
                  Just a number — no birthday forms. Motion is built for ages 12–22.
                </p>
              </div>
              <input
                value={age}
                onChange={(e) => setAge(e.target.value.replace(/\D/g, "").slice(0, 2))}
                inputMode="numeric"
                placeholder="16"
                autoFocus
                className="h-12 w-32 rounded-xl border border-zinc-800 bg-zinc-900 px-4 text-lg text-zinc-100 focus:border-violet-500/50 focus:outline-none"
              />
              {age !== "" && !ageValid && (
                <p className="text-xs text-red-400">Motion is for ages 12–22 right now.</p>
              )}
            </div>
          )}

          {/* ---- step 2: interests ---- */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h1 className="font-display text-2xl font-bold">Pick your interests</h1>
                <p className="mt-1 text-sm text-zinc-500">
                  Choose 3 to 6 — we'll use them to seed your feed.
                </p>
                <p className="mt-2 text-xs font-medium text-violet-300">
                  {interests.length} selected
                </p>
              </div>
              {INTEREST_GROUPS.map((group) => (
                <div key={group.label}>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    {group.label}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {group.items.map((tag) => {
                      const active = interests.includes(tag);
                      return (
                        <button
                          key={tag}
                          onClick={() => toggleInterest(tag)}
                          className={cn(
                            "rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                            active
                              ? "border-violet-500 bg-violet-500/15 text-violet-200"
                              : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                          )}
                        >
                          {tag}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ---- step 3: goal + feed vibe ---- */}
          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h1 className="font-display text-2xl font-bold">Set your course</h1>
                <p className="mt-1 text-sm text-zinc-500">
                  Two quick picks — you can change these anytime in Settings.
                </p>
              </div>
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  What are you here for?
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {GOALS.map((g) => (
                    <button
                      key={g}
                      onClick={() => setGoal(g)}
                      className={cn(
                        "rounded-xl border px-4 py-3 text-left text-sm transition-colors",
                        goal === g
                          ? "border-violet-500 bg-violet-500/15 text-violet-100"
                          : "border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-700"
                      )}
                    >
                      {g}
                      {goal === g && <Check size={14} className="ml-1 inline text-violet-400" />}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Preferred feed vibe
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {FEED_VIBES.map((v) => (
                    <button
                      key={v}
                      onClick={() => setVibe(v)}
                      className={cn(
                        "rounded-xl border px-4 py-3 text-left text-sm transition-colors",
                        vibe === v
                          ? "border-violet-500 bg-violet-500/15 text-violet-100"
                          : "border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-700"
                      )}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {error && <p className="mt-5 text-sm text-red-400">{error}</p>}
        </div>

        {/* footer controls */}
        <div className="mt-8 flex items-center justify-between">
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            className={cn(
              "flex items-center gap-1.5 text-sm text-zinc-500 transition hover:text-zinc-200",
              step === 0 && "invisible"
            )}
          >
            <ArrowLeft size={15} /> Back
          </button>
          {step < 2 ? (
            <Button onClick={next} disabled={!canContinue} className="rounded-full px-7">
              Continue <ArrowRight />
            </Button>
          ) : (
            <Button onClick={submit} disabled={busy || !goal} className="rounded-full px-7">
              {busy ? <Loader2 className="animate-spin" /> : <Check />}
              Enter Motion
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
