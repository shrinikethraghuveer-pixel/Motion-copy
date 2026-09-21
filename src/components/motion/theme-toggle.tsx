"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Subtle dark/light switcher. Persists to localStorage and flips the
 * `data-theme` attribute on <html>; globals.css handles the palette swap.
 * Reads the stored value only after mount to avoid hydration mismatches.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem("motion-theme");
    if (stored === "light" || stored === "dark") setTheme(stored);
    setMounted(true);
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    window.localStorage.setItem("motion-theme", next);
    document.documentElement.setAttribute("data-theme", next);
  }

  return (
    <button
      onClick={toggle}
      aria-label="Toggle light mode"
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
        "text-zinc-600 hover:bg-black/5 hover:text-zinc-900",
        "dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
      )}
    >
      {mounted && theme === "light" ? (
        <Sun size={19} strokeWidth={1.8} className="shrink-0" />
      ) : (
        <Moon size={19} strokeWidth={1.8} className="shrink-0" />
      )}
      <span>{mounted && theme === "light" ? "Light mode" : "Dark mode"}</span>
      {/* tiny track indicator */}
      <span
        className={cn(
          "ml-auto flex h-4 w-7 items-center rounded-full border transition-colors",
          "border-zinc-300 bg-zinc-200",
          "dark:border-white/10 dark:bg-zinc-800"
        )}
      >
        <span
          className={cn(
            "mx-0.5 size-3 rounded-full bg-violet-500 transition-transform",
            mounted && theme === "light" ? "translate-x-3" : "translate-x-0"
          )}
        />
      </span>
    </button>
  );
}

export default ThemeToggle;
