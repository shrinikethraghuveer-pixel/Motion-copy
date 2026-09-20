"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Bell,
  Compass,
  Home,
  LogOut,
  MessageCircle,
  Search,
  Settings,
  Sparkles,
  User as UserIcon,
  Plus,
  Users,
} from "lucide-react";
import { api, type SuggestedUser } from "@/lib/client";
import { useSession, useUI } from "@/components/providers";
import { Avatar, Chip, GoldMLogo } from "@/components/ui/primitives";
import { ConnectMessageButtons } from "@/components/profile/ProfileHeaderCard";

const NAV = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/chat", label: "Chat", icon: MessageCircle },
  { href: "/my-space", label: "My Space", icon: Sparkles, featured: true },
  { href: "/profile", label: "Profile", icon: UserIcon },
  { href: "/settings", label: "Settings", icon: Settings },
];

function TopBar() {
  const { me, unreadCount, pendingRequests, signOut } = useSession();
  const { openComposer, openProfile } = useUI();
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const centerItems = [
    { key: "home", label: "H", title: "Home", active: pathname === "/home", onClick: () => router.push("/home") },
    { key: "create", label: "+", title: "Create post", active: false, onClick: openComposer },
    { key: "connections", label: "C", title: "Connections", active: pathname === "/connections", onClick: () => router.push("/connections") },
  ];

  return (
    <header className="glass-soft sticky top-0 z-50 rounded-none border-x-0 border-t-0">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4">
        <Link href="/home" className="flex items-center gap-2.5">
          <GoldMLogo size={34} />
          <span className="font-display hidden text-lg font-bold tracking-tight sm:block">Motion</span>
        </Link>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            router.push(`/explore?q=${encodeURIComponent(q)}`);
          }}
          className="relative hidden max-w-xs flex-1 md:block"
        >
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-mist" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search students, skills…"
            className="w-full rounded-full border border-edge bg-surface/70 py-2 pl-9 pr-4 text-sm placeholder:text-mist/60"
          />
        </form>

        <div className="glass-pill mx-auto flex items-center gap-1 p-1">
          {centerItems.map((item) => (
            <button
              key={item.key}
              onClick={item.onClick}
              title={item.title}
              className={`font-display h-8 w-9 rounded-full text-sm font-bold transition ${
                item.active ? "bg-gradient-to-br from-gold/30 to-ice/25 text-gold shadow-[0_0_14px_rgba(251,191,36,0.25)]" : "text-mist hover:text-ink"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <Link href="/chat" className="relative rounded-full p-2 text-mist transition hover:text-ink" title="Direct messages">
            <MessageCircle size={19} />
            {pendingRequests > 0 && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-ice ring-2 ring-canvas" />}
          </Link>
          <Link href="/notifications" className="relative rounded-full p-2 text-mist transition hover:text-ink" title="Notifications">
            <Bell size={19} />
            {unreadCount > 0 && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-gold ring-2 ring-canvas" />}
          </Link>
          <div className="relative" ref={menuRef}>
            <button onClick={() => setMenuOpen((v) => !v)} className="ml-1 rounded-full ring-1 ring-edge transition hover:ring-gold/40" title="Profile">
              {me ? <Avatar user={me} size={32} /> : <span className="block h-8 w-8 rounded-full bg-card2" />}
            </button>
            {menuOpen && (
              <div className="glass absolute right-0 top-11 z-50 w-48 p-1.5 text-sm">
                <button onClick={() => { setMenuOpen(false); openProfile(me!.handle); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-card2">
                  <UserIcon size={14} /> View my profile
                </button>
                <button onClick={() => { setMenuOpen(false); router.push("/my-space"); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-card2">
                  <Sparkles size={14} /> My Space
                </button>
                <button
                  onClick={() => { setMenuOpen(false); signOut(); }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-coral hover:bg-card2"
                >
                  <LogOut size={14} /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

function LeftSidebar() {
  const pathname = usePathname();
  const { me } = useSession();

  return (
    <aside className="sticky top-20 hidden h-fit w-56 shrink-0 flex-col gap-1 lg:flex">
      {NAV.map(({ href, label, icon: Icon, featured }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-3 rounded-2xl px-4 py-2.5 text-sm font-medium transition ${
              featured
                ? "border border-gold/30 bg-gold-soft text-gold hover:brightness-125"
                : active
                  ? "glass text-gold"
                  : "text-mist hover:bg-card2/60 hover:text-ink"
            }`}
          >
            <Icon size={18} />
            {label}
          </Link>
        );
      })}
      {me && (
        <div className="glass-soft mt-3 p-3.5 text-xs text-mist">
          <p className="font-display text-sm font-semibold text-ink">{me.name}</p>
          <p className="mt-0.5">@{me.handle}</p>
          <p className="mt-1.5">{me.school}</p>
        </div>
      )}
    </aside>
  );
}

function RightSidebar() {
  const { toast } = useUI();
  const [suggestions, setSuggestions] = useState<SuggestedUser[]>([]);
  const { openProfile } = useUI();

  const load = async () => {
    try {
      const r = await api<{ suggestions: SuggestedUser[] }>("/api/suggestions");
      setSuggestions(r.suggestions);
    } catch {
      /* signed out */
    }
  };
  useEffect(() => {
    load();
    const h = () => load();
    window.addEventListener("motion:refresh", h);
    return () => window.removeEventListener("motion:refresh", h);
  }, []);

  return (
    <aside className="sticky top-20 hidden h-fit w-72 shrink-0 flex-col gap-3 xl:flex">
      <div className="glass p-4">
        <h2 className="font-display mb-3 flex items-center gap-2 text-sm font-bold">
          <Users size={15} className="text-gold" /> Suggested Motions
        </h2>
        <div className="space-y-3">
          {suggestions.length === 0 && <p className="text-xs text-mist">You know everyone here — for now. ⚡</p>}
          {suggestions.map((s) => (
            <div key={s.user.id} className="flex items-start gap-2.5">
              <button onClick={() => openProfile(s.user.handle)}>
                <Avatar user={s.user} size={38} />
              </button>
              <div className="min-w-0 flex-1">
                <button onClick={() => openProfile(s.user.handle)} className="block truncate text-sm font-semibold hover:text-gold">
                  {s.user.name}
                </button>
                <p className="truncate text-xs text-mist">{s.user.school}</p>
                <p className="truncate text-[11px] text-gold/80">{s.reason}</p>
                {s.sharedSkills.length > 0 && (
                  <p className="truncate text-[11px] text-mist">Shared: {s.sharedSkills.slice(0, 2).join(", ")}</p>
                )}
              </div>
              <div className="shrink-0">
                <ConnectMessageButtons user={s.user} size="sm" onChange={load} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="glass-soft p-4 text-xs text-mist">
        <p className="font-display mb-1 text-sm font-semibold text-ink">Motion Values</p>
        <p>67% professional · 33% social. Portfolios over resumes, always.</p>
      </div>
    </aside>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <TopBar />
      <div className="mx-auto flex max-w-7xl gap-6 px-4 pt-6">
        <LeftSidebar />
        <main className="min-w-0 flex-1 pb-20">{children}</main>
        <RightSidebar />
      </div>
    </div>
  );
}
