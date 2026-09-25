"use client";

import Link from "next/link";

/** Keeps onboarding failures out of the application-wide error boundary. */
export default function OnboardingError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="grid min-h-screen place-items-center bg-zinc-950 px-6 text-center text-zinc-100">
      <div>
        <h1 className="text-xl font-semibold">We couldn&apos;t load onboarding</h1>
        <p className="mt-2 text-sm text-zinc-400">Please try again to finish setting up your account.</p>
        <div className="mt-5 flex justify-center gap-3">
          <button type="button" onClick={reset} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500">Try again</button>
          <Link href="/" className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800">Return to Motion</Link>
        </div>
      </div>
    </main>
  );
}
