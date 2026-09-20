"use client";

import { useCallback, useEffect, useState } from "react";
import { UserPlus, Users } from "lucide-react";
import { api, type ConnectionsPayload } from "@/lib/client";
import { useUI } from "@/components/providers";
import { Avatar, EmptyState } from "@/components/ui/primitives";
import { ConnectMessageButtons } from "@/components/profile/ProfileHeaderCard";

export default function ConnectionsPage() {
  const { openProfile, toast } = useUI();
  const [data, setData] = useState<ConnectionsPayload | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<ConnectionsPayload>("/api/connections"));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to load connections");
    }
  }, [toast]);

  useEffect(() => {
    load();
    const h = () => load();
    window.addEventListener("motion:refresh", h);
    return () => window.removeEventListener("motion:refresh", h);
  }, [load]);

  if (!data) return <div className="glass-soft h-64 animate-pulse rounded-2xl" />;

  return (
    <div className="space-y-5">
      <h1 className="font-display text-2xl font-bold">Connections</h1>

      {data.incoming.length > 0 && (
        <section>
          <h2 className="font-display mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-ice">
            <UserPlus size={14} /> Received — {data.incoming.length}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {data.incoming.map((u) => (
              <div key={u.id} className="glass flex items-center gap-3 p-4">
                <button onClick={() => openProfile(u.handle)}><Avatar user={u} size={44} /></button>
                <div className="min-w-0 flex-1">
                  <button onClick={() => openProfile(u.handle)} className="block truncate font-semibold hover:text-gold">{u.name}</button>
                  <p className="truncate text-xs text-mist">{u.school}</p>
                </div>
                <ConnectMessageButtons user={u} size="sm" onChange={load} />
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="font-display mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-mist">
          <Users size={14} /> Your circle — {data.friends.length}
        </h2>
        {data.friends.length === 0 ? (
          <EmptyState icon={<Users size={26} />} title="No connections yet" hint="Tap + Connect on any suggestion — when they accept, you're instantly mutuals." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {data.friends.map((u) => (
              <div key={u.id} className="glass flex items-center gap-3 p-4">
                <button onClick={() => openProfile(u.handle)}><Avatar user={u} size={44} /></button>
                <div className="min-w-0 flex-1">
                  <button onClick={() => openProfile(u.handle)} className="block truncate font-semibold hover:text-gold">{u.name}</button>
                  <p className="truncate text-xs text-mist">{u.school}</p>
                </div>
                <ConnectMessageButtons user={u} size="sm" onChange={load} />
              </div>
            ))}
          </div>
        )}
      </section>

      {data.outgoing.length > 0 && (
        <section>
          <h2 className="font-display mb-2 text-sm font-bold uppercase tracking-wide text-mist">Sent — waiting</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {data.outgoing.map((u) => (
              <div key={u.id} className="glass flex items-center gap-3 p-4 opacity-80">
                <button onClick={() => openProfile(u.handle)}><Avatar user={u} size={44} /></button>
                <div className="min-w-0 flex-1">
                  <button onClick={() => openProfile(u.handle)} className="block truncate font-semibold hover:text-gold">{u.name}</button>
                  <p className="truncate text-xs text-mist">Request pending</p>
                </div>
                <ConnectMessageButtons user={u} size="sm" onChange={load} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
