"use client";

import { Suspense } from "react";
import { AuthModal } from "@/components/auth-modal";
import { Feed } from "@/components/x/feed";
import { NavSidebar } from "@/components/x/nav-sidebar";
import { RightWidgets } from "@/components/x/right-widgets";
import { Button } from "@/components/ui/shadcn/button";

function LoginShell() {
  return (
    <div className="relative min-h-screen bg-obsidian text-foreground">
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -left-40 -top-40 size-[30rem] rounded-full bg-violet-700/20 blur-[110px]" />
        <div className="absolute right-[-8rem] top-1/3 size-[26rem] rounded-full bg-cyan-600/15 blur-[110px]" />
        <div className="absolute bottom-[-6rem] left-1/3 size-[24rem] rounded-full bg-indigo-700/15 blur-[110px]" />
      </div>

      <div className="relative z-10 mx-auto grid max-w-7xl grid-cols-[auto_minmax(0,1fr)] gap-0 lg:grid-cols-[auto_minmax(0,1fr)_300px]">
        <NavSidebar />
        <main>
          <Feed />
        </main>
        <RightWidgets />
      </div>

      <div className="fixed right-4 top-4 z-30">
        <Button size="pill" className="w-auto px-5">
          Sign in
        </Button>
        <AuthModal open={true} onOpenChange={() => {}} />
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-obsidian" />}>
      <LoginShell />
    </Suspense>
  );
}
