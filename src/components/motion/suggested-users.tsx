"use client";

import Link from "next/link";
import { useEffect, useState, type MouseEvent } from "react";
import { Check, LoaderCircle, UserPlus } from "lucide-react";
import { Avatar } from "@/components/ui/primitives";
import { api, post } from "@/lib/client";
import { useUI } from "@/components/providers";

interface SuggestedUser {
  id: string;
  name: string;
  handle: string;
  photo?: string | null;
  subtitle?: string;
  connectionState?: string;
  isMock?: boolean;
}

const FALLBACK_USERS: SuggestedUser[] = [
  { id: "sample-ava", name: "Ava Chen", handle: "avabuilds", subtitle: "Creative technologist", isMock: true },
  { id: "sample-noah", name: "Noah Patel", handle: "noahcodes", subtitle: "Building with AI", isMock: true },
  { id: "sample-maya", name: "Maya Rivera", handle: "mayamakes", subtitle: "Design · Robotics", isMock: true },
];

export default function SuggestedUsers() {
  const [users, setUsers] = useState<SuggestedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const { toast } = useUI();

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    void api<{ users?: SuggestedUser[] }>("/api/users/suggested", { signal: controller.signal })
      .then((result) => {
        if (!active) return;
        setUsers(Array.isArray(result.users) && result.users.length > 0 ? result.users.slice(0, 5) : FALLBACK_USERS);
      })
      .catch(() => { if (active) setUsers(FALLBACK_USERS); })
      .finally(() => {
        window.clearTimeout(timeout);
        if (active) setLoading(false);
      });
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, []);

  const connect = async (event: MouseEvent<HTMLButtonElement>, user: SuggestedUser) => {
    event.preventDefault();
    event.stopPropagation();
    if (busy || user.connectionState === "pending_out" || user.connectionState === "connected") return;
    const previousState = user.connectionState;
    setUsers((current) => current.map((item) => item.id === user.id ? { ...item, connectionState: "pending_out" } : item));
    setBusy(user.id);
    try {
      const result = await post<{ state: string }>("/api/connections", { targetHandle: user.handle, action: "connect" });
      setUsers((current) => current.map((item) => item.id === user.id ? { ...item, connectionState: result.state } : item));
    } catch (error) {
      setUsers((current) => current.map((item) => item.id === user.id ? { ...item, connectionState: previousState } : item));
      toast(error instanceof Error ? error.message : "Couldn't send connection request");
    } finally {
      setBusy(null);
    }
  };

  return <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 backdrop-blur-md" aria-label="Suggested for you">
    <h2 className="mb-3 text-sm font-semibold text-zinc-100">Suggested for You</h2>
    {loading ? <div className="space-y-3" aria-label="Loading suggestions">{[0,1,2].map((key) => <div key={key} className="h-12 animate-pulse rounded-xl bg-zinc-800/50" />)}</div> : users.length === 0 ? <p className="text-xs text-zinc-500">No new people to suggest right now.</p> : <div className="space-y-3">
      {users.map((user) => {
        const connected = user.connectionState === "connected";
        const pending = user.connectionState === "pending_out" || user.connectionState === "pending";
        return <div key={user.id} className="flex items-center gap-2.5">
          <Link href={user.isMock ? "/connect" : `/profile/${encodeURIComponent(user.handle)}`} className="shrink-0" aria-label={`View ${user.name}'s profile`}><Avatar user={{ id: user.id, name: user.name, photo: user.photo ?? undefined }} size={36} /></Link>
          <Link href={user.isMock ? "/connect" : `/profile/${encodeURIComponent(user.handle)}`} className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-zinc-100">{user.name}</span>
            <span className="block truncate text-xs text-zinc-500">@{user.handle}</span>
            <span className="block truncate text-[10px] text-zinc-600">{user.subtitle ?? "Popular in Motion"}</span>
          </Link>
          {user.isMock ? <Link href="/connect" className="inline-flex shrink-0 items-center rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500">Explore</Link> : <button
            type="button"
            onClick={(event) => void connect(event, user)}
            disabled={busy === user.id || pending || connected}
            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:cursor-default ${connected || pending ? "bg-zinc-700 text-zinc-300" : "cursor-pointer bg-indigo-600 hover:bg-indigo-500"}`}
          >
            {busy === user.id ? <LoaderCircle size={13} className="animate-spin" /> : connected ? <Check size={13} /> : pending ? null : <UserPlus size={13} />}
            {connected ? "Connected" : pending ? "Pending" : "Connect"}
          </button>}
        </div>;
      })}
    </div>}
    <Link href="/connect/suggested" className="block cursor-pointer pt-2 text-xs font-medium text-sky-400 hover:underline">Show more</Link>
  </section>;
}
