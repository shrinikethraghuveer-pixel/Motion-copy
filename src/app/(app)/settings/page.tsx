"use client";

import { LogOut, ShieldCheck } from "lucide-react";
import { useSession } from "@/components/providers";
import { Avatar, Chip } from "@/components/ui/primitives";

export default function SettingsPage() {
  const { me, signOut } = useSession();

  if (!me) return null;

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">Settings</h1>

      <section className="glass flex items-center gap-4 p-5">
        <Avatar user={me} size={64} ring />
        <div className="flex-1">
          <p className="font-display text-lg font-bold">{me.name}</p>
          <p className="text-sm text-mist">@{me.handle} · {me.school}</p>
          <div className="mt-2 flex gap-2">
            <Chip tone={me.ageTag === "18+" ? "ice" : "gold"}>{me.ageTag}</Chip>
            {me.skills.slice(0, 3).map((s) => (
              <Chip key={s}>{s}</Chip>
            ))}
          </div>
        </div>
      </section>

      <section className="glass p-5">
        <h2 className="font-display flex items-center gap-2 text-lg font-bold">
          <ShieldCheck size={18} className="text-ice" /> Safety
        </h2>
        <ul className="mt-3 space-y-2 text-sm text-mist">
          <li>· Reporting is 3 taps: post menu → select reason → submit. The reported party is never notified.</li>
          <li>· Message requests from non-connections stay silent until accepted.</li>
          <li>· Connections between any age brackets are open and frictionless, like Instagram.</li>
        </ul>
      </section>

      <button onClick={signOut} className="glass flex w-full items-center justify-center gap-2 p-4 text-sm font-semibold text-coral hover:border-coral/30">
        <LogOut size={16} /> Sign out
      </button>
    </div>
  );
}
