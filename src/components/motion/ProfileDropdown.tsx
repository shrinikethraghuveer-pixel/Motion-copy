"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, UserRound } from "lucide-react";
import { useSession } from "@/components/providers";

export default function ProfileDropdown({ compact = false }: { compact?: boolean }) {
  const { me, signOut } = useSession();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const profileHref = me?.onboardedAt && me.handle
    ? `/profile/${encodeURIComponent(me.handle)}`
    : "/onboarding";

  useEffect(() => {
    setOpen(false);
    setConfirming(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) { setOpen(false); setConfirming(false); }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); setConfirming(false); }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function confirmLogout() {
    setBusy(true);
    try { await signOut(); } catch { window.location.assign("/welcome"); }
    finally { setBusy(false); }
  }

  return (
    <div className="relative shrink-0" ref={root}>
      <button
        type="button"
        aria-label="Open profile menu"
        aria-haspopup="menu"
        aria-expanded={open}
        title={me ? `@${me.handle}` : "Your profile"}
        onClick={() => { setOpen((value) => !value); setConfirming(false); }}
        className={`aspect-square grid place-items-center overflow-hidden rounded-full border border-zinc-200/80 bg-gradient-to-br from-cyan-500 to-violet-600 font-bold text-white transition hover:border-violet-400 hover:shadow-[0_0_18px_rgba(139,92,246,.35)] dark:border-white/10 ${compact ? "size-8 text-[11px]" : "size-9 text-xs"}`}
      >
        {me?.photo ? <img src={me.photo} alt={me.name} className="size-full rounded-full object-cover" /> : <span aria-hidden="true">{me?.name?.slice(0, 1).toUpperCase() ?? "M"}</span>}
      </button>
      {open && <div role="menu" aria-label="Profile menu" className="absolute right-0 top-full z-[60] mt-2 w-64 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/95 p-2 text-zinc-100 shadow-2xl shadow-black/50 backdrop-blur-2xl">
        {!confirming ? <>
          <div className="border-b border-white/[.08] px-3 py-2.5"><p className="truncate text-sm font-semibold">{me?.name ?? "Motion account"}</p>{me?.handle && <p className="mt-0.5 truncate text-xs text-zinc-500">@{me.handle}</p>}</div>
          <Link href={profileHref} role="menuitem" onClick={() => setOpen(false)} className="mt-1 flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-zinc-300 transition hover:bg-white/[.07] hover:text-white"><UserRound size={16} className="text-violet-300" />Your Profile</Link>
          <button type="button" role="menuitem" onClick={() => setConfirming(true)} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-zinc-300 transition hover:bg-rose-500/10 hover:text-rose-200"><LogOut size={16} className="text-rose-300" />Log Out</button>
        </> : <div className="p-2"><p className="px-1 py-2 text-sm font-semibold">Are you sure you want to log out?</p><div className="mt-2 flex gap-2"><button type="button" disabled={busy} onClick={() => void confirmLogout()} className="flex-1 rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-rose-500 disabled:opacity-50">{busy ? "Logging out…" : "Confirm"}</button><button type="button" disabled={busy} onClick={() => setConfirming(false)} className="flex-1 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-300 hover:bg-white/[.06]">Cancel</button></div></div>}
      </div>}
    </div>
  );
}
