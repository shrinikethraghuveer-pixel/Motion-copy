"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import MotionLogo from "@/components/brand/MotionLogo";
import { createClient } from "@/lib/supabase/client";
import { signInWithEmail, signUpWithEmail } from "@/lib/supabase/auth";

/* ───────────────────────── tokens (Obsidian liquid-glass) ───────────────────────── */

const INPUT =
  "w-full rounded-lg border border-zinc-700 bg-zinc-800/50 " +
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
type AuthMode = "signin" | "signup";

export default function CoreAuthCard({
  standalone = false,
  initialMode = "signup",
}: {
  standalone?: boolean;
  initialMode?: AuthMode;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [fields, setFields] = useState<CoreAuthFields>({ name: "", email: "", handle: "", password: "" });
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [offerSignup, setOfferSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  const set = (key: keyof CoreAuthFields) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setFields((f) => ({ ...f, [key]: e.target.value }));
    setErr(null);
    setOfferSignup(false);
  };

  const canSubmit = mode === "signin"
    ? fields.handle.trim().length > 0 && fields.password.length >= 8
    : fields.name.trim().length >= 2 &&
      /^\S+@\S+\.\S+$/.test(fields.email.trim()) &&
      /^[a-zA-Z0-9_.-]{3,20}$/.test(fields.handle.trim().replace(/^@+/, "")) &&
      fields.password.length >= 8;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setErr(null);
    try {
      if (mode === "signup") {
        const result = await signUpWithEmail(
          fields.email.trim(),
          fields.password,
          fields.handle.trim().replace(/^@+/, "").toLowerCase(),
          fields.name.trim()
        );
        if (result.error) throw new Error(result.error);
        if (result.needsConfirmation) {
          setErr("Check your inbox to confirm your email, then sign in.");
          return;
        }
        router.push("/onboarding");
        router.refresh();
      } else {
        const result = await signInWithEmail(fields.handle.trim(), fields.password);
        if (result.error) {
          // Password failures remain generic, but an email-based attempt gets
          // an explicit opt-in route to registration; it never creates an
          // account from a failed sign-in.
          const email = fields.handle.trim();
          if (email.includes("@")) {
            setErr("We couldn't find an account for that email, or the password is incorrect.");
            setOfferSignup(true);
            return;
          }
          throw new Error(result.error);
        }
        router.push("/home");
        router.refresh();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : mode === "signup" ? "Signup failed" : "Sign in failed");
      setBusy(false);
    }
  }

  async function continueWithGoogle() {
    setErr(null);
    setGoogleBusy(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback?next=/home` },
      });
      if (error) setErr(error.message);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Google sign-in failed.");
    } finally {
      setGoogleBusy(false);
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
          {mode === "signup" ? "Create your account" : "Welcome back"}
        </h1>
        <p className="mt-1 text-sm light:text-zinc-600 dark:text-zinc-400">
          {mode === "signup" ? "One minute to join — personalize right after." : "Sign in to continue building on Motion."}
        </p>
      </div>

      <div role="tablist" aria-label="Authentication options" className="mt-6 grid grid-cols-2 rounded-xl border light:border-slate-300 dark:border-zinc-700 bg-black/5 dark:bg-black/20 p-1">
        {(["signin", "signup"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={mode === tab}
            onClick={() => {
              if (tab === "signup" && fields.handle.includes("@") && !fields.email) setFields((f) => ({ ...f, email: f.handle }));
              setMode(tab); setErr(null); setOfferSignup(false);
            }}
            className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${mode === tab ? "bg-violet-600 text-white shadow" : "light:text-zinc-600 dark:text-zinc-400 hover:light:text-zinc-900 hover:dark:text-zinc-100"}`}
          >
            {tab === "signin" ? "Sign In" : "Get Started"}
          </button>
        ))}
      </div>

      <div className="mt-6 space-y-3">
        {mode === "signup" && <>
        <input value={fields.name} onChange={set("name")} placeholder="Full name" autoComplete="name" maxLength={40} className={INPUT} />
        <input value={fields.email} onChange={set("email")} placeholder="Email" type="email" autoComplete="email" className={INPUT} />
        </>}
        <div className="relative">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm light:text-zinc-400 dark:text-zinc-500">@</span>
          <input
            value={fields.handle}
            onChange={(e) => { setFields((f) => ({ ...f, handle: e.target.value.replace(/^@+/, "").toLowerCase() })); setErr(null); }}
            placeholder={mode === "signin" ? "Email or username" : "Username"}
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
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
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

      {err && <div className="mb-4 mt-3 rounded-lg border border-red-800/50 bg-red-950/40 p-3 text-xs font-medium text-red-400">{err}</div>}
      {offerSignup && mode === "signin" && (
        <button type="button" onClick={() => { setFields((f) => ({ ...f, email: f.handle })); setMode("signup"); setErr(null); setOfferSignup(false); }} className="mt-3 w-full rounded-xl border border-violet-500/60 px-4 py-3 text-sm font-semibold text-violet-600 transition-colors hover:bg-violet-500/10 dark:text-violet-300">
          Create an account with this email
        </button>
      )}

      <button
        type="submit"
        disabled={!canSubmit || busy}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-600/25 transition-all hover:bg-violet-700 disabled:opacity-40"
      >
        {busy && <Loader2 size={16} className="animate-spin" />}
        {mode === "signup" ? "Create account" : "Sign in"}
      </button>
      <div className="my-4 flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[.18em] text-zinc-500"><span className="h-px flex-1 bg-zinc-800" />or continue with<span className="h-px flex-1 bg-zinc-800" /></div>
      <button type="button" onClick={() => void continueWithGoogle()} disabled={busy || googleBusy} className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-white/10 bg-white/[.04] px-4 py-3 text-sm font-semibold text-zinc-200 transition hover:border-white/20 hover:bg-white/[.08] disabled:opacity-50">
        <span aria-hidden="true" className="grid size-5 place-items-center rounded-full bg-white text-xs font-black text-blue-600">G</span>
        {googleBusy ? "Connecting to Google…" : "Continue with Google"}
      </button>
      <p className="mt-3 text-center text-xs light:text-zinc-500 dark:text-zinc-500">
        {mode === "signup" ? "Already have an account? " : "New to Motion? "}
        <button type="button" onClick={() => {
          const nextMode = mode === "signup" ? "signin" : "signup";
          if (nextMode === "signup" && fields.handle.includes("@") && !fields.email) setFields((f) => ({ ...f, email: f.handle }));
          setMode(nextMode); setErr(null); setOfferSignup(false);
        }} className="font-semibold text-violet-600 dark:text-violet-400 hover:underline">
          {mode === "signup" ? "Sign in" : "Get started"}
        </button>
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
