"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);

  return <html lang="en"><body className="bg-zinc-950 text-white"><main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6 text-center"><h1 className="text-2xl font-semibold">Something went wrong</h1><p className="mt-2 text-sm text-zinc-400">The error has been recorded. Please try again.</p><button className="mt-5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium" onClick={() => reset()}>Try again</button></main></body></html>;
}
