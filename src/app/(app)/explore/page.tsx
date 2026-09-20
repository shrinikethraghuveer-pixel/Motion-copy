"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { api, type ExplorePayload } from "@/lib/client";
import { useUI } from "@/components/providers";
import { Avatar, EmptyState } from "@/components/ui/primitives";
import { ConnectMessageButtons } from "@/components/profile/ProfileHeaderCard";

export default function ExplorePage() {
  const params = useSearchParams();
  const { toast, openProfile } = useUI();
  const [tag, setTag] = useState("All");
  const [q, setQ] = useState(params.get("q") ?? "");
  const [data, setData] = useState<ExplorePayload | null>(null);

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams({ tag });
      if (q.trim()) p.set("q", q.trim());
      setData(await api<ExplorePayload>(`/api/explore?${p}`));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to load explore");
    }
  }, [tag, q, toast]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-5">
      <h1 className="font-display text-2xl font-bold">Explore</h1>

      <div className="glass p-4">
        <div className="relative mb-4">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-mist" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search students by name, handle, school…"
            className="w-full rounded-full border border-edge bg-surface/70 py-2 pl-9 pr-4 text-sm placeholder:text-mist/60"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {(data?.tags ?? ["All"]).map((t) => (
            <button
              key={t}
              onClick={() => setTag(t)}
              className={`rounded-full border px-3.5 py-1.5 text-sm transition ${tag === t ? "border-gold/50 bg-gold-soft text-gold" : "border-edge text-mist hover:text-ink"}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <section>
        <h2 className="font-display mb-3 text-sm font-bold uppercase tracking-wide text-mist">Students</h2>
        {!data ? (
          <div className="glass-soft h-40 animate-pulse rounded-2xl" />
        ) : data.people.length === 0 ? (
          <EmptyState icon={<span className="text-2xl">🔭</span>} title="No students match" hint="Try another interest or clear the search." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {data.people.map((u) => (
              <div key={u.id} className="glass flex items-center gap-3 p-4">
                <button onClick={() => openProfile(u.handle)}>
                  <Avatar user={u} size={44} />
                </button>
                <div className="min-w-0 flex-1">
                  <button onClick={() => openProfile(u.handle)} className="block truncate font-semibold hover:text-gold">{u.name}</button>
                  <p className="truncate text-xs text-mist">{u.school}</p>
                  <p className="truncate text-[11px] text-gold/80">{u.skills.slice(0, 3).join(" · ")}</p>
                </div>
                <ConnectMessageButtons user={u} size="sm" onChange={load} />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
