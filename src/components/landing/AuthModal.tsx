"use client";

import { X } from "lucide-react";
import CoreAuthCard from "@/components/auth/CoreAuthCard";

/**
 * AuthModal — Phase 1 core sign-up in a glass dialog.
 * The demo-account toggle is gone: one clean path — create account, then the
 * post-auth /onboarding questionnaire personalizes the experience.
 */
export default function AuthModal({ onClose, initialMode = "signup" }: { onClose: () => void; initialMode?: "signin" | "signup" }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={initialMode === "signup" ? "Create your Motion account" : "Sign in to Motion"}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-100 shadow-2xl"
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-full p-1.5 light:text-zinc-500 dark:text-zinc-400 transition-colors hover:light:bg-slate-100 hover:dark:bg-zinc-800 hover:light:text-zinc-900 dark:hover:text-zinc-100"
        >
          <X size={18} />
        </button>
        <CoreAuthCard initialMode={initialMode} />
      </div>
    </div>
  );
}
