"use client";

import Navbar from "@/components/motion/navbar";
import MessagingDrawer from "@/components/motion/messaging-drawer";

/** Shared authenticated layout with paired liquid-glass and obsidian surfaces. */
export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-200/70 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <Navbar />
      <main className="min-h-screen animate-in fade-in slide-in-from-bottom-1 duration-200 pb-24 pt-20 lg:pb-8">
        {children}
      </main>
      <MessagingDrawer />
    </div>
  );
}
