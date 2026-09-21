"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarDays, MessageCircle, Sparkles, Users, Zap } from "lucide-react";
import { api } from "@/lib/client";
import { useSession } from "@/components/providers";
import AuthModal from "@/components/landing/AuthModal";
import { GoldMLogo } from "@/components/ui/primitives";

const FEATURES = [
  { icon: Users, title: "Network that moves", text: "Mutual-first connections built for students — no corporate cards, no cold DMs required.", tone: "text-ice" },
  { icon: Zap, title: "Pulse opportunities", text: "Internships, hackathons and campus events with a metallic Pulse badge — save them straight to your calendar.", tone: "text-gold" },
  { icon: MessageCircle, title: "Chats that respect focus", text: "Messages from non-connections wait in Requests. Nothing interrupts your flow.", tone: "text-coral" },
  { icon: CalendarDays, title: "Your school, your space", text: "Classmates, campus news and clubs — organized in My Space, not another email thread.", tone: "text-ice" },
];

export default function LandingPage() {
  const router = useRouter();
  const { me, loading } = useSession();
  const [authOpen, setAuthOpen] = useState(false);
  const [demoHandles, setDemoHandles] = useState<Array<{ handle: string; name: string }>>([]);

  useEffect(() => {
    if (!loading && me) router.replace("/home");
  }, [me, loading, router]);

  useEffect(() => {
    api<{ demoHandles: Array<{ handle: string; name: string }> }>("/api/session")
      .then((d) => setDemoHandles(d.demoHandles))
      .catch(() => {});
  }, []);

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="orb orb-drift -left-32 -top-32 h-96 w-96 bg-gold/30" />
      <div className="orb orb-drift right-[-10rem] top-40 h-[28rem] w-[28rem] bg-ice/25" style={{ animationDelay: "-6s" }} />
      <div className="orb orb-drift bottom-[-8rem] left-1/3 h-80 w-80 bg-coral/20" style={{ animationDelay: "-3s" }} />

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-5">
        <div className="flex items-center gap-2.5">
          <GoldMLogo size={36} />
          <span className="font-display text-xl font-bold">Motion</span>
        </div>
        <button onClick={() => setAuthOpen(true)} className="glass-pill px-5 py-2 text-sm font-semibold text-gold transition hover:brightness-125">
          Sign in
        </button>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-6 pb-24">
        <section className="fade-up mx-auto mt-16 max-w-3xl text-center">
          <span className="glass-pill inline-flex items-center gap-2 px-4 py-1.5 text-xs font-semibold text-gold">
            <Sparkles size={13} /> The student platform, not another LinkedIn
          </span>
          <h1 className="font-display mt-6 text-5xl font-bold leading-tight tracking-tight sm:text-6xl">
            Where Students
            <br />
            Build <span className="pulse-badge">Motion</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg text-mist">
            Network with peers, share what you're building, and find real opportunities — internships, hackathons, clubs — without the corporate resume theater.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <button onClick={() => setAuthOpen(true)} className="flex items-center gap-2 rounded-full bg-gradient-to-r from-gold to-amber-500 px-8 py-3.5 font-display text-base font-bold text-canvas shadow-[0_0_30px_rgba(251,191,36,0.3)] transition hover:brightness-110">
              Get Started <ArrowRight size={18} />
            </button>
            <button onClick={() => setAuthOpen(true)} className="glass-pill px-8 py-3.5 text-base font-semibold text-ice transition hover:brightness-125">
              Try a demo account
            </button>
          </div>
          <p className="mt-4 text-xs text-mist">
            Gmail, Apple ID or phone/email · no school-domain checks · 3 quick questions
          </p>
        </section>

        <section className="mt-20 grid gap-4 sm:grid-cols-2">
          {FEATURES.map((f, i) => (
            <div key={f.title} className={`glass fade-up fade-up-${i + 1} p-6`}>
              <f.icon size={22} className={f.tone} />
              <h3 className="font-display mt-3 text-lg font-bold">{f.title}</h3>
              <p className="mt-1.5 text-sm text-mist">{f.text}</p>
            </div>
          ))}
        </section>

        {demoHandles.length > 0 && (
          <section className="glass-soft fade-up mt-12 p-6 text-center">
            <p className="text-sm text-mist">
              Demo crew: {demoHandles.map((d) => d.name).join(" · ")} — all passwords <code className="text-gold">demo</code>
            </p>
          </section>
        )}
      </main>

      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
    </div>
  );
}
