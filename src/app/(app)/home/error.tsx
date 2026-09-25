"use client";

import Link from "next/link";

/** Keeps a feed rendering failure scoped to /home instead of the global crash UI. */
export default function HomeError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center text-zinc-100">
      <h1 className="text-xl font-semibold">We couldn&apos;t load your home feed</h1>
      <p className="mt-2 max-w-sm text-sm text-zinc-400">Your account is safe. Please try again or return to Motion.</p>
      <div className="mt-5 flex gap-3">
        <button type="button" onClick={reset} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500">Try again</button>
        <Link href="/" className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800">Return to Motion</Link>
      </div>
    </main>
  );
}
