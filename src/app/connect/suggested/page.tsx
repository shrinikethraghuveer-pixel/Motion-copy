"use client";

import Link from "next/link";
import { useEffect, useState, type MouseEvent } from "react";
import { Check, LoaderCircle, UserPlus, Users } from "lucide-react";
import { Navbar } from "@/components/motion/navbar";
import { Avatar } from "@/components/ui/primitives";
import { api, post } from "@/lib/client";
import { useUI } from "@/components/providers";

type SuggestedPerson = {
  id: string;
  name: string;
  handle: string;
  photo?: string | null;
  headline?: string;
  bio?: string;
  subtitle?: string;
  mutualCount?: number;
  connectionState?: string;
};

export default function SuggestedPeoplePage() {
  const [people, setPeople] = useState<SuggestedPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const { toast } = useUI();

  useEffect(() => {
    let alive = true;
    void api<{ users?: SuggestedPerson[] }>("/api/users/suggested?limit=30")
      .then((result) => { if (alive) setPeople(Array.isArray(result.users) ? result.users : []); })
      .catch(() => { if (alive) toast("Couldn't load suggested people"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [toast]);

  const connect = async (event: MouseEvent<HTMLButtonElement>, person: SuggestedPerson) => {
    event.preventDefault();
    event.stopPropagation();
    if (busy || person.connectionState === "pending_out" || person.connectionState === "connected") return;
    const previous = person.connectionState;
    setPeople((current) => current.map((item) => item.id === person.id ? { ...item, connectionState: "pending_out" } : item));
    setBusy(person.id);
    try {
      const result = await post<{ state: string }>("/api/connections", { targetHandle: person.handle, action: "connect" });
      setPeople((current) => current.map((item) => item.id === person.id ? { ...item, connectionState: result.state } : item));
    } catch (error) {
      setPeople((current) => current.map((item) => item.id === person.id ? { ...item, connectionState: previous } : item));
      toast(error instanceof Error ? error.message : "Couldn't send connection request");
    } finally { setBusy(null); }
  };

  return <div className="min-h-screen bg-zinc-950 text-zinc-100">
    <Navbar />
    <main className="mx-auto max-w-7xl px-4 pb-16 pt-8 lg:px-6 lg:pt-24">
      <header className="mb-7"><Link href="/connect" className="text-xs font-medium text-sky-400 hover:underline">← Back to Connect</Link><h1 className="mt-3 text-xl font-bold text-zinc-100">Suggested people for you</h1><p className="mt-1 text-sm text-zinc-400">People you may know based on mutual connections, interests, and activity.</p></header>
      {loading ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <div key={index} className="h-44 animate-pulse rounded-2xl border border-zinc-800 bg-zinc-900/60" />)}</div> : people.length === 0 ? <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 text-center text-sm text-zinc-400 backdrop-blur-md">No new people to suggest right now.</div> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {people.map((person) => {
          const pending = person.connectionState === "pending" || person.connectionState === "pending_out";
          const connected = person.connectionState === "connected";
          return <article key={person.id} className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 backdrop-blur-md transition hover:border-zinc-700">
            <div className="flex items-start gap-3"><Link href={`/profile/${encodeURIComponent(person.handle)}`}><Avatar user={{ id: person.id, name: person.name, photo: person.photo ?? undefined }} size={46} /></Link><div className="min-w-0 flex-1"><Link href={`/profile/${encodeURIComponent(person.handle)}`} className="block truncate text-sm font-semibold text-zinc-100 hover:text-indigo-300">{person.name}</Link><p className="truncate text-xs text-zinc-500">@{person.handle}</p><p className="mt-1 truncate text-[11px] text-zinc-400">{person.mutualCount ? `${person.mutualCount} mutual connection${person.mutualCount === 1 ? "" : "s"}` : person.subtitle ?? "Popular in Motion"}</p></div></div>
            <p className="mt-4 line-clamp-2 min-h-10 text-xs text-zinc-400">{person.bio || person.headline || "Creating, learning, and sharing work with the Motion community."}</p>
            <button type="button" onClick={(event) => void connect(event, person)} disabled={busy === person.id || pending || connected} className={`mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium text-white transition-colors disabled:cursor-default ${pending || connected ? "bg-zinc-700 text-zinc-300" : "cursor-pointer bg-indigo-600 hover:bg-indigo-500"}`}>{busy === person.id ? <LoaderCircle size={14} className="animate-spin" /> : connected ? <Check size={14} /> : pending ? null : <UserPlus size={14} />}{connected ? "Connected" : pending ? "Pending" : "+ Connect"}</button>
          </article>;
        })}
      </div>}
    </main>
  </div>;
}
