"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import {
  Bell,
  Compass,
  Home,
  LayoutGrid,
  MessageSquare,
  Search,
  Settings,
  Share2,
  Sparkles,
} from "lucide-react";
import SearchBar from "@/components/motion/search";
import ThemeToggle from "@/components/motion/theme-toggle";
import { cn } from "@/lib/utils";

const NAV = [
  { key: "home", label: "Home", href: "/", icon: Home },
  { key: "connect", label: "Connect", href: "/connect", icon: Share2 },
  { key: "myspace", label: "My Space", href: "/my-space", icon: LayoutGrid },
  { key: "explore", label: "Explore", href: "/explore", icon: Compass },
  { key: "notifications", label: "Notifications", href: "/notifications", icon: Bell },
  { key: "messages", label: "Messages", href: "/messages", icon: MessageSquare },
  { key: "settings", label: "Settings", href: "/settings", icon: Settings },
];

const GLASS = "border-b border-slate-300/70 bg-slate-100/80 backdrop-blur-xl shadow-sm dark:border-zinc-800/80 dark:bg-zinc-900/60 dark:shadow-none";

function GlowButton({
  onClick,
  label,
  children,
  className,
}: {
  onClick?: () => void;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "relative grid size-9 place-items-center rounded-full border border-zinc-200/80 bg-white/70 text-zinc-600 transition-all duration-200 dark:border-white/10 dark:bg-zinc-900/50 dark:text-zinc-400",
        "hover:border-violet-300 hover:bg-zinc-100/60 hover:text-zinc-900 hover:shadow-[0_0_18px_rgba(139,92,246,0.18)] dark:hover:border-violet-500/50 dark:hover:bg-zinc-800/40 dark:hover:text-violet-300 dark:hover:shadow-[0_0_18px_rgba(139,92,246,0.35)]",
        className
      )}
    >
      {children}
    </button>
  );
}

function activeNavKey(pathname: string): string {
  if (pathname === "/" || pathname === "/home") return "home";
  if (pathname.startsWith("/connect")) return "connect";
  if (pathname.startsWith("/my-space")) return "myspace";
  if (pathname.startsWith("/explore")) return "explore";
  if (pathname.startsWith("/notifications")) return "notifications";
  if (pathname.startsWith("/messages") || pathname.startsWith("/chat")) return "messages";
  if (pathname.startsWith("/settings")) return "settings";
  return "";
}

export function Navbar({
  onAssistant,
  onProfile,
}: {
  onAssistant?: () => void;
  onProfile?: () => void;
}) {
  const pathname = usePathname();
  const active = activeNavKey(pathname);

  return (
    <>
      {/* ================= desktop: floating glass top bar ================= */}
      <header className={cn("fixed left-1/2 top-3 z-40 hidden w-[min(96rem,94%)] -translate-x-1/2 rounded-2xl lg:block", GLASS)}>
        <div className="flex h-14 items-center gap-4 px-5">
          {/* brand */}
          <Image src="/logo.png" alt="Motion" width={34} height={34} className="object-contain" priority />

          {/* search — autocomplete lives in its own component */}
          <div className="w-40 min-w-0 xl:w-56">
            <SearchBar />
          </div>

          {/* center tabs — shrink-0 so labels never wrap; search absorbs the squeeze */}
          <nav className="relative mx-auto flex shrink-0 items-center gap-1">
            {NAV.map(({ key, label, href, icon: Icon }) => {
              const isActive = active === key;
              return (
                <Link
                  key={key}
                  data-nav-key={key}
                  title={label}
                  href={href}
                  prefetch={true}
                  className={cn(
                    "group relative z-10 flex items-center gap-1.5 rounded-full border px-1.5 py-2 text-xs font-medium transition-colors duration-200 xl:gap-2 xl:px-2 xl:text-[13px]",
                    isActive ? "border-slate-300/80 bg-white text-violet-700 font-semibold shadow-sm dark:border-violet-500/40 dark:bg-violet-600/30 dark:text-violet-300" : "border-transparent text-zinc-600 hover:bg-slate-200/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/40 dark:hover:text-zinc-100"
                  )}
                >
                  {/* soft hover wash; the sliding pill handles the active state */}
                  <span className="absolute inset-0 z-0 rounded-full bg-white/0 transition-colors duration-200 group-hover:bg-white/5" />
                  {/* icon stays fully visible in every state; tints cyan→violet when pressed */}
                  <Icon
                    size={17}
                    strokeWidth={1.8}
                    className={cn(
                      "relative z-10 shrink-0 transition-colors duration-200",
                      isActive ? "text-violet-700 dark:text-violet-300" : ""
                    )}
                  />
                  <span className="relative z-10 whitespace-nowrap">{label}</span>
                  {!isActive && (
                    <span className="ml-0.5 size-1.5 rounded-full bg-violet-500 opacity-0 transition-opacity duration-200 group-hover:opacity-40" />
                  )}
                </Link>
              );
            })}
          </nav>

          {/* right actions */}
          <div className="ml-auto flex items-center gap-2">
            <span className="mr-1 hidden items-center gap-1.5 text-[11px] text-zinc-500 xl:flex">
              <ThemeToggle />
            </span>
            <GlowButton onClick={onAssistant} label="AI Assistant">
              <Sparkles size={16} />
            </GlowButton>
            <button
              onClick={onProfile}
              aria-label="Open profile"
              className="size-9 overflow-hidden rounded-full border border-zinc-200/80 bg-gradient-to-br from-cyan-500 to-violet-600 text-xs font-bold text-white transition-all duration-200 hover:border-violet-500/50 hover:shadow-[0_0_18px_rgba(139,92,246,0.35)] dark:border-white/10"
            >
              M
            </button>
          </div>
        </div>
      </header>

      {/* ================= mobile: floating glass bottom bar ================= */}
      <nav
        className={cn(
          "fixed bottom-3 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-2xl px-2 py-1.5 lg:hidden",
          GLASS
        )}
      >
        {NAV.slice(0, 5).map(({ key, label, href, icon: Icon }) => {
          const isActive = active === key;
          return (
            <Link
              key={key}
              data-nav-key={key}
              title={label}
              href={href}
              prefetch={true}
              className={cn(
                "relative z-10 flex flex-col items-center gap-0.5 rounded-xl border px-2.5 py-1.5 text-[9px] font-medium transition-colors duration-200",
                isActive ? "border-slate-300/80 bg-white text-violet-700 font-semibold shadow-sm dark:border-violet-500/40 dark:bg-violet-600/30 dark:text-violet-300" : "border-transparent text-zinc-600 hover:bg-slate-200/60 hover:text-zinc-900 dark:text-zinc-500 dark:hover:bg-zinc-800/40 dark:hover:text-zinc-200"
              )}
            >
              <Icon size={18} strokeWidth={1.8} />
              {label.split(" ")[0]}
            </Link>
          );
        })}
        <button
          onClick={onAssistant}
          aria-label="AI Assistant"
          className="relative z-10 ml-1 grid size-9 place-items-center rounded-full bg-gradient-to-br from-cyan-500 to-violet-600 text-white shadow-[0_0_16px_rgba(139,92,246,0.4)] transition hover:opacity-90"
        >
          <Sparkles size={16} />
        </button>
      </nav>
    </>
  );
}

export default Navbar;
