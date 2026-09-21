"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import { api, post } from "@/lib/client";
import { GOAL_OPTIONS, SKILL_OPTIONS, type Goal, type Grade } from "@/lib/schema";
import { useSession } from "@/components/providers";
import { Modal } from "@/components/ui/primitives";
import { DEMO_PASSWORD } from "@/lib/constants";

const STEPS = ["Stage", "Interests", "Goal"] as const;

const GRADES: Array<{ key: Grade; label: string; hint: string }> = [
  { key: "middle", label: "Middle School", hint: "Grades 6–8" },
  { key: "high", label: "High School", hint: "Grades 9–12" },
  { key: "college", label: "College", hint: "University / Undergrad" },
];

export default function AuthModal({ onClose }: { onClose: () => void }) {
  const { refresh } = useSession();
  const [tab, setTab] = useState<"signup" | "demo">("signup");
  const [step, setStep] = useState(0);

  // signup state
  const [handle, setHandle] = useState("");
  const [grade, setGrade] = useState<Grade | null>(null);
  const [age, setAge] = useState<string>("");
  const ageNum = Number(age);
  const ageValid = Number.isInteger(ageNum) && ageNum >= 10 && ageNum <= 30;
  const previewTag = ageValid ? (ageNum >= 18 ? "18+" : "<18") : null;
  const suggestedGrade: Grade | null = ageValid ? (ageNum <= 13 ? "middle" : ageNum <= 18 ? "high" : "college") : null;
  const [skills, setSkills] = useState<string[]>([]);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // demo state
  const [demoHandle, setDemoHandle] = useState("mayacodes");
  const [demoErr, setDemoErr] = useState<string | null>(null);

  const toggleSkill = (s: string) => {
    setSkills((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : cur.length < 5 ? [...cur, s] : cur));
  };

  const signup = async () => {
    setBusy(true);
    setErr(null);
    try {
      await post("/api/session", { mode: "signup", handle, grade, age: ageNum, skills, goal });
      window.location.assign("/home"); // full navigation picks up the fresh session cookie
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Signup failed");
      setBusy(false);
    }
  };

  const demoLogin = async () => {
    setBusy(true);
    setDemoErr(null);
    try {
      await post("/api/session", { mode: "demo", handle: demoHandle, password: DEMO_PASSWORD });
      window.location.assign("/home");
    } catch (e) {
      setDemoErr(e instanceof Error ? e.message : "Login failed");
      setBusy(false);
    }
  };

  const canNext =
    (step === 0 && !!grade && ageValid) ||
    (step === 1 && skills.length >= 3 && skills.length <= 5) ||
    step === 2;

  return (
    <Modal onClose={onClose} wide>
      <div className="mb-5 flex items-center gap-1 rounded-full border border-edge bg-surface/60 p-1 text-sm">
        {(["signup", "demo"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-full px-4 py-1.5 font-semibold transition ${tab === t ? "bg-gradient-to-r from-gold/25 to-ice/20 text-gold" : "text-mist hover:text-ink"}`}
          >
            {t === "signup" ? "Join Motion" : "Try a demo account"}
          </button>
        ))}
      </div>

      {tab === "demo" ? (
        <div className="space-y-4">
          <p className="text-sm text-mist">Hop into a seeded account to explore both sides of every flow (connections, DM requests, saves). Password is prefilled: <code className="text-gold">demo</code></p>
          <select
            value={demoHandle}
            onChange={(e) => setDemoHandle(e.target.value)}
            className="w-full rounded-xl border border-edge bg-surface/80 px-3 py-2.5 text-sm"
          >
            <option value="mayacodes">Maya Chen — @mayacodes (college · 18+)</option>
            <option value="arjun.builds">Arjun Mehta — @arjun.builds (college · 18+)</option>
            <option value="zoedesigns">Zoe Alvarez — @zoedesigns (high school · &lt;18)</option>
            <option value="liamtech">Liam Park — @liamtech (college · 18+)</option>
            <option value="priyacodes">Priya Nair — @priyacodes (high school · &lt;18)</option>
            <option value="samfilms">Sam Rivera — @samfilms (high school · &lt;18)</option>
          </select>
          {demoErr && <p className="text-sm text-coral">{demoErr}</p>}
          <button onClick={demoLogin} disabled={busy} className="w-full rounded-xl bg-gradient-to-r from-gold to-amber-500 py-2.5 font-display font-bold text-canvas hover:brightness-110 disabled:opacity-50">
            {busy ? "Signing in…" : "Enter Motion"}
          </button>
        </div>
      ) : (
        <div>
          <div className="mb-6 flex items-center gap-2">
            {STEPS.map((label, i) => (
              <div key={label} className="flex flex-1 items-center gap-2">
                <span className={`font-display flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${i <= step ? "bg-gold text-canvas" : "border border-edge text-mist"}`}>{i + 1}</span>
                <span className={`text-xs font-semibold ${i <= step ? "text-ink" : "text-mist"}`}>{label}</span>
                {i < STEPS.length - 1 && <span className={`h-px flex-1 ${i < step ? "bg-gold/50" : "bg-edge"}`} />}
              </div>
            ))}
          </div>

          {step === 0 && (
            <div className="space-y-3">
              <p className="text-sm text-mist">First, what's your academic stage? One number and you're set — no birthday forms.</p>
              <p className="-mt-2 text-xs text-mist/80">
                Handle: <input value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase())} placeholder="e.g. jesse.builds" className="ml-2 w-44 rounded-lg border border-edge bg-surface/80 px-2.5 py-1 text-sm" />
                <span className="ml-2">Age:</span>
                <input
                  value={age}
                  onChange={(e) => setAge(e.target.value.replace(/\D/g, "").slice(0, 2))}
                  inputMode="numeric"
                  placeholder="16"
                  className="ml-2 w-16 rounded-lg border border-edge bg-surface/80 px-2.5 py-1 text-sm"
                />
                {previewTag && (
                  <span className={`ml-2 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${ageNum >= 18 ? "border-ice/40 text-ice" : "border-gold/40 text-gold"}`}>
                    {previewTag}
                  </span>
                )}
              </p>
              {age !== "" && !ageValid && <p className="-mt-1 text-xs text-coral">Enter an age between 10 and 30.</p>
              }
              {GRADES.map((g) => (
                <button
                  key={g.key}
                  onClick={() => setGrade(g.key)}
                  className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition ${grade === g.key ? "border-gold/50 bg-gold-soft" : "border-edge hover:border-ice/40"}`}
                >
                  <span>
                    <span className="font-display block font-semibold">{g.label}</span>
                    <span className="text-xs text-mist">{g.hint}</span>
                  </span>
                  {g.key === suggestedGrade && <span className="text-[11px] font-semibold text-ice">suggested</span>}
                </button>
              ))}
            </div>
          )}

          {step === 1 && (
            <div>
              <p className="mb-3 text-sm text-mist">Pick 3 to 5 interests — these power suggestions.</p>
              <div className="flex flex-wrap gap-2">
                {SKILL_OPTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => toggleSkill(s)}
                    className={`rounded-full border px-3.5 py-1.5 text-sm transition ${skills.includes(s) ? "border-gold/50 bg-gold-soft text-gold" : "border-edge text-mist hover:border-ice/40 hover:text-ink"}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs text-mist">{skills.length}/5 selected</p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <p className="text-sm text-mist">What brings you to Motion?</p>
              {GOAL_OPTIONS.map((g) => (
                <button
                  key={g}
                  onClick={() => setGoal(g)}
                  className={`block w-full rounded-2xl border px-4 py-3 text-left font-medium transition ${goal === g ? "border-gold/50 bg-gold-soft text-gold" : "border-edge hover:border-ice/40"}`}
                >
                  {g}
                </button>
              ))}
            </div>
          )}

          {err && <p className="mt-3 text-sm text-coral">{err}</p>}

          <div className="mt-6 flex items-center justify-between">
            <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} className="flex items-center gap-1.5 rounded-full border border-edge px-4 py-2 text-sm text-mist disabled:opacity-40 hover:text-ink">
              <ArrowLeft size={15} /> Back
            </button>
            {step < 2 ? (
              <button onClick={() => setStep((s) => s + 1)} disabled={!canNext} className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-gold to-amber-500 px-5 py-2 text-sm font-bold text-canvas disabled:opacity-40 hover:brightness-110">
                Next <ArrowRight size={15} />
              </button>
            ) : (
              <button onClick={signup} disabled={busy || !goal} className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-gold to-amber-500 px-5 py-2 text-sm font-bold text-canvas disabled:opacity-40 hover:brightness-110">
                <Sparkles size={15} /> {busy ? "Creating…" : "Join Motion"}
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
