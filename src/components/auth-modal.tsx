"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mail, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/shadcn/dialog";
import { Input } from "@/components/ui/shadcn/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/shadcn/tabs";
import {
  sendMagicLink,
  signInWithEmail,
  signUpWithEmail,
  type SessionUser,
} from "@/lib/supabase/auth";
import { Wand2 } from "lucide-react";

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (session: SessionUser | null) => void;
}

export function AuthModal({ open, onOpenChange, onSuccess }: AuthModalProps) {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function finish() {
    onOpenChange(false);
    router.push(mode === "signup" ? "/onboarding" : "/home");
    router.refresh();
    onSuccess?.(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        const uname = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
        if (uname.length < 3) {
          setErrorMessage("Username needs 3+ characters (a–z, 0–9, _).");
          return;
        }
        const res = await signUpWithEmail(email, password, uname, fullName.trim() || undefined);
        if (res.error) {
          setErrorMessage(res.error);
          return;
        }
        if (res.needsConfirmation) {
          setNotice("Check your inbox — confirm your email to finish signing up.");
          return;
        }
      } else {
        const res = await signInWithEmail(email, password);
        if (res.error) {
          setErrorMessage(res.error);
          return;
        }
      }
      await finish();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            <span className="x-gradient-text">Join Motion</span>
          </DialogTitle>
          <DialogDescription>
            Where students build motion — one account for every device.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => { setMode(v as typeof mode); setErrorMessage(null); setNotice(null); }}>
          <TabsList className="w-full">
            <TabsTrigger value="signin" className="flex-1">Sign in</TabsTrigger>
            <TabsTrigger value="signup" className="flex-1">Create account</TabsTrigger>
          </TabsList>

          <TabsContent value="signin">
            <form onSubmit={handleSubmit} className="mt-2 space-y-3">
              <Input
                type="email" required placeholder="you@anywhere.com" autoComplete="email"
                value={email} onChange={(e) => { setEmail(e.target.value); setErrorMessage(null); }}
              />
              <Input
                type="password" required minLength={8} autoComplete="current-password"
                placeholder="Password (8+ characters)"
                value={password} onChange={(e) => { setPassword(e.target.value); setErrorMessage(null); }}
              />
              {notice && <p className="text-sm text-cyan-300">{notice}</p>}
              {errorMessage && <div className="mb-4 rounded-lg border border-red-800/50 bg-red-950/40 p-3 text-xs font-medium text-red-400">{errorMessage}</div>}
              <Button type="submit" size="pill" disabled={busy} className="w-full">
                {busy ? <Loader2 className="animate-spin" /> : <Mail />}
                Sign in
              </Button>
              <div className="flex items-center gap-3 pt-1 text-[11px] uppercase tracking-wide text-zinc-600">
                <span className="h-px flex-1 bg-zinc-800" />or<span className="h-px flex-1 bg-zinc-800" />
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={busy || !email.trim()}
                className="w-full"
                onClick={async () => {
                  setErrorMessage(null);
                  setNotice(null);
                  setBusy(true);
                  const res = await sendMagicLink(email.trim());
                  setBusy(false);
                  if (res.error) setErrorMessage(res.error);
                  else setNotice("Magic link sent — check your inbox to finish signing in.");
                }}
              >
                <Wand2 />
                Email me a magic link
              </Button>
              <p className="text-center text-[11px] text-zinc-600">
                Any valid email works — no school-domain checks.
              </p>
            </form>
          </TabsContent>

          <TabsContent value="signup">
            <form onSubmit={handleSubmit} className="mt-2 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Input
                  required placeholder="Username" autoComplete="username"
                  title="3+ characters: a–z, 0–9, underscore"
                  value={username} onChange={(e) => { setUsername(e.target.value); setErrorMessage(null); }}
                />
                <Input
                  placeholder="Full name (optional)" autoComplete="name"
                  value={fullName} onChange={(e) => { setFullName(e.target.value); setErrorMessage(null); }}
                />
              </div>
              <Input
                type="email" required placeholder="you@anywhere.com" autoComplete="email"
                value={email} onChange={(e) => { setEmail(e.target.value); setErrorMessage(null); }}
              />
              <Input
                type="password" required minLength={8} autoComplete="new-password"
                placeholder="Password (8+ characters)"
                value={password} onChange={(e) => { setPassword(e.target.value); setErrorMessage(null); }}
              />
              {notice && <p className="text-sm text-cyan-300">{notice}</p>}
              {errorMessage && <div className="mb-4 rounded-lg border border-red-800/50 bg-red-950/40 p-3 text-xs font-medium text-red-400">{errorMessage}</div>}
              <Button type="submit" size="pill" disabled={busy} className="w-full">
                {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
                Create account
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

export default AuthModal;
