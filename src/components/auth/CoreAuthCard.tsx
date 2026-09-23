"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { post } from "@/lib/client";
import type { PublicUser } from "@/lib/schema";
import MotionLogo from "@/components/brand/MotionLogo";

/* ───────────────────────── tokens (Obsidian liquid-glass) ───────────────────────── */

const INPUT =
  "w-full rounded-2xl border light:border-slate-300/80 dark:border-zinc-700 light:bg-slate-100 dark:bg-zinc-800 " +
  "px-4 py-3 text-sm light:text-zinc-900 dark:text-zinc-100 outline-none transition-colors " +
  "light:placeholder:text-zinc-400 dark:placeholder:text-zinc-500 " +
  "light:focus:border-violet-500 dark:focus:border-violet-500/70";

export interface CoreAuthFields {
  name: string;
  email: string;
  handle: string;
  password: string;
}

/**
 * CoreAuthCard — Phase 1 of the streamlined flow: email/password/handle only.
 * Stage, interests, goals, and discovery live in the post-auth /onboarding
 * questionnaire. Wraps itself in a page canvas when `standalone` (the /signup
 * route); the AuthModal renders the same card inside its glass dialog.
 */
export default function CoreAuthCard({ standalone = false }: { standalone?: boolean }) {
  const router = useRouter();
  const [fields, setFields] = useState<CoreAuthFields>({ name: "", email: "", handle: "", password: "" });
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof CoreAuthFields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFields((f) => ({ ...f, [key]: e.target.value }));

  const canSubmit =
    fields.name.trim().length >= 2 &&
    /^\S+@\S+\.\S+$/.test(fields.email.trim()) &&
    /^[a-zA-Z0-9_.-]{3,20}$/.test(fields.handle.trim().replace(/^@+/, "")) &&
    fields.password.length >= 8;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await post("/api/session", {
        mode: "signup",
        name: fields.name.trim(),
        email: fields.email.trim(),
        handle: fields.handle.trim(),
        password: fields.password,
      });
      // Session cookie is set — the questionnaire picks up from here.
      router.push("/onboarding");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Signup failed");
      setBusy(false);
    }
  }

  const card = (
    <form
      onSubmit={submit}
      className={
        standalone
          ? "w-full max-w-md rounded-3xl border light:border-slate-300/80 dark:border-zinc-800/80 light:bg-white/90 dark:bg-zinc-900/80 p-8 backdrop-blur-xl light:shadow-2xl light:shadow-slate-300/60 dark:shadow-none"
          : ""
      }
    >
      <div className="flex flex-col items-center text-center">
        <MotionLogo size="md" href={null} />
        <h1 className="mt-4 text-2xl font-bold tracking-tight light:text-zinc-950 dark:text-zinc-100">
          Create your account
        </h1>
        <p className="mt-1 text-sm light:text-zinc-600 dark:text-zinc-400">
          One minute to join — personalize right after.
        </p>
      </div>

      <div className="mt-6 space-y-3">
        <input value={fields.name} onChange={set("name")} placeholder="Full name" autoComplete="name" maxLength={40} className={INPUT} />
        <input value={fields.email} onChange={set("email")} placeholder="Email" type="email" autoComplete="email" className={INPUT} />
        <div className="relative">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm light:text-zinc-400 dark:text-zinc-500">@</span>
          <input
            value={fields.handle}
            onChange={(e) => setFields((f) => ({ ...f, handle: e.target.value.replace(/^@+/, "").toLowerCase() }))}
            placeholder="username"
            autoComplete="username"
            maxLength={20}
            className={`${INPUT} pl-9`}
          />
        </div>
        <div className="relative">
          <input
            value={fields.password}
            onChange={set("password")}
            placeholder="Password (8+ characters)"
            type={showPw ? "text" : "password"}
            autoComplete="new-password"
            className={`${INPUT} pr-11`}
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            aria-label={showPw ? "Hide password" : "Show password"}
            className="absolute right-3 top-1/2 -translate-y-1/2 light:text-zinc-400 dark:text-zinc-500 transition-colors hover:text-violet-600 dark:hover:text-violet-400"
          >
            {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      {err && <p className="mt-3 text-sm light:text-rose-600 dark:text-rose-400">{err}</p>}

      <button
        type="submit"
        disabled={!canSubmit || busy}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-600/25 transition-all hover:bg-violet-700 disabled:opacity-40"
      >
        {busy && <Loader2 size={16} className="animate-spin" />}
        Create account
      </button>
      <p className="mt-3 text-center text-xs light:text-zinc-500 dark:text-zinc-500">
        Already have an account?{" "}
        <a href="/login" className="font-semibold text-violet-600 dark:text-violet-400 hover:underline">
          Sign in
        </a>
      </p>
    </form>
  );

  if (!standalone) return card;

  return (
    <div className={`${"light:bg-slate-200/70 dark:bg-zinc-950"} relative flex min-h-screen items-center justify-center px-4 py-12`}>
      <div className="mesh-gradient" aria-hidden="true" />
      {card}
    </div>
  );
}
