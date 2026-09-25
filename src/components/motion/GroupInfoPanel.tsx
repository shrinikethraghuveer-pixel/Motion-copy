"use client";

import { useEffect, useState } from "react";
import { CalendarDays, Check, Crown, Loader2, Search, UserMinus, Users, X } from "lucide-react";
import type { DmGroupDetail } from "@/lib/dm-backends";
import { addGroupMembers, searchUsers } from "@/lib/dm-backends";
import type { PublicUser } from "@/lib/schema";
import { Avatar } from "@/components/ui/primitives";

/**
 * Group Info / Settings panel — details, roster with Admin badges,
 * Add Members search, and Leave Group. Rendered in place of the message
 * stream (or as a slide-over) when the chat header is clicked.
 */
export default function GroupInfoPanel({
  group,
  isCreator,
  onClose,
  onChanged,
  onLeave,
}: {
  group: DmGroupDetail;
  /** Creator row gets the Crown badge; only the creator sees admin tools today. */
  isCreator: boolean;
  onClose: () => void;
  /** Called after members were added so the page can refresh the roster. */
  onChanged: () => void;
  onLeave: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicUser[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    const t = window.setTimeout(async () => {
      try {
        setResults(await searchUsers(q));
      } catch {
        setResults([]);
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [query]);

  const memberIds = new Set(group.members.map((m) => m.user.id));

  const addPicked = async () => {
    if (picked.length === 0 || working) return;
    setWorking(true);
    setError(null);
    try {
      await addGroupMembers(group.id, picked);
      setPicked([]);
      setQuery("");
      setResults([]);
      setAdding(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add members");
    } finally {
      setWorking(false);
    }
  };

  const leave = async () => {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      onLeave();
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-2xl border border-zinc-700/80 bg-gradient-to-br from-violet-600/50 to-cyan-500/40 text-lg font-bold text-white">
            {group.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- user-supplied URL
              <img src={group.avatarUrl} alt={group.name} className="size-full object-cover" />
            ) : (
              group.name.slice(0, 1).toUpperCase()
            )}
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold text-zinc-900 dark:text-zinc-100">{group.name}</p>
            <p className="flex items-center gap-1.5 text-xs text-zinc-500">
              <Users size={11} /> {group.memberCount} member{group.memberCount === 1 ? "" : "s"}
            </p>
          </div>
        </div>
        <button onClick={onClose} className="rounded-full border border-zinc-700/70 bg-zinc-800/50 p-1.5 text-zinc-400 transition hover:text-zinc-100" aria-label="Close group info">
          <X size={15} />
        </button>
      </div>

      {group.description && (
        <p className="mt-3 rounded-xl border border-zinc-200 bg-white/50 p-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-300">{group.description}</p>
      )}

      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-zinc-500">
        <CalendarDays size={11} /> Created {new Date(group.createdAt).toLocaleDateString()}
      </p>

      {/* Roster */}
      <h3 className="mt-5 text-xs font-semibold uppercase tracking-wider text-zinc-500">Members</h3>
      <div className="mt-2 space-y-1">
        {group.members.map((m) => (
          <div key={m.user.id} className="flex items-center gap-2.5 rounded-xl px-2 py-2 transition hover:bg-slate-200/50 dark:hover:bg-zinc-800/40">
            <Avatar user={{ id: m.user.id, name: m.user.name, photo: m.user.photo }} size={32} />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                {m.user.name}
                {m.role === "admin" && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-600/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-violet-500 dark:text-violet-300">
                    <Crown size={9} /> Admin
                  </span>
                )}
              </p>
              <p className="truncate text-[11px] text-zinc-500">@{m.user.handle}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Add members */}
      {adding ? (
        <div className="mt-4 rounded-xl border border-zinc-200 bg-white/50 p-3 dark:border-zinc-800 dark:bg-zinc-800/40">
          <label className="relative block">
            <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search users to add…"
              className="w-full rounded-xl border border-zinc-300 bg-slate-100 py-2 pl-9 pr-3 text-xs text-zinc-900 outline-none transition focus:border-violet-500/60 dark:border-zinc-700/60 dark:bg-zinc-800/50 dark:text-zinc-100 placeholder:text-zinc-500"
              aria-label="Search users to add"
            />
          </label>
          <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
            {results.map((u) => {
              const already = memberIds.has(u.id);
              const active = picked.includes(u.id);
              return (
                <button
                  key={u.id}
                  disabled={already}
                  onClick={() => setPicked((cur) => (cur.includes(u.id) ? cur.filter((x) => x !== u.id) : [...cur, u.id]))}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition ${already ? "cursor-default opacity-40" : active ? "bg-violet-600/15" : "hover:bg-zinc-800/40 dark:hover:bg-zinc-800/60"}`}
                >
                  <Avatar user={{ id: u.id, name: u.name, photo: u.photo }} size={24} />
                  <span className="min-w-0 flex-1 truncate text-xs text-zinc-900 dark:text-zinc-200">{u.name} <span className="text-zinc-500">@{u.handle}</span></span>
                  {already ? (
                    <span className="text-[10px] text-zinc-500">member</span>
                  ) : (
                    <span className={`grid size-4 shrink-0 place-items-center rounded-md border ${active ? "border-violet-500 bg-violet-600 text-white" : "border-zinc-600"}`}>
                      {active && <Check size={10} />}
                    </span>
                  )}
                </button>
              );
            })}
            {query.trim() && results.length === 0 && <p className="px-2 py-1.5 text-xs text-zinc-500">No users found.</p>}
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={addPicked} disabled={picked.length === 0 || working} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-violet-600 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50">
              {working ? <Loader2 size={12} className="animate-spin" /> : <UserMinus size={12} className="rotate-180" />} Add {picked.length > 0 ? `(${picked.length})` : ""}
            </button>
            <button onClick={() => { setAdding(false); setPicked([]); }} className="rounded-lg border border-zinc-300 bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300 dark:hover:bg-zinc-700/70">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="mt-4 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-violet-500/40 bg-violet-600/10 py-2.5 text-xs font-semibold text-violet-600 transition hover:bg-violet-600/20 dark:text-violet-300"
        >
          <UserPlusIcon /> Add Members
        </button>
      )}

      {error && <p className="mt-3 text-xs text-rose-400">{error}</p>}

      <button
        onClick={leave}
        disabled={working}
        className="mt-4 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 py-2.5 text-xs font-semibold text-rose-500 transition hover:bg-rose-500/20 disabled:opacity-50 dark:text-rose-400"
      >
        {working ? <Loader2 size={12} className="animate-spin" /> : null} Leave Group
      </button>
    </div>
  );
}

function UserPlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" x2="19" y1="8" y2="14" />
      <line x1="22" x2="16" y1="11" y2="11" />
    </svg>
  );
}
