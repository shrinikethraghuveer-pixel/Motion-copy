"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, GraduationCap, MapPin, Newspaper, Users } from "lucide-react";
import { api, post, type MySpacePayload } from "@/lib/client";
import { eventCountdown, eventDateLabel } from "@/lib/utils";
import { useUI } from "@/components/providers";
import { Avatar, Chip, EmptyState } from "@/components/ui/primitives";
import { ConnectMessageButtons } from "@/components/profile/ProfileHeaderCard";

const KIND_TONE: Record<string, "gold" | "ice" | "coral"> = {
  internship: "gold",
  hackathon: "ice",
  event: "coral",
};

export default function MySpacePage() {
  const { toast, openProfile } = useUI();
  const [data, setData] = useState<MySpacePayload | null>(null);
  const [groups, setGroups] = useState<GroupsShape | null>(null);

  const loadGroups = useCallback(async () => {
    return api<GroupsShape>("/api/groups");
  }, []);

  const load = useCallback(async () => {
    try {
      setData(await api<MySpacePayload>("/api/my-space"));
      setGroups(await loadGroups());
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to load My Space");
    }
  }, [loadGroups, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const groupAction = async (groupId: string, action: "join" | "leave") => {
    try {
      await post("/api/groups", { action, groupId });
      await load();
      toast(action === "join" ? "Joined — welcome in!" : "Left the group");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Action failed");
    }
  };

  if (!data) return <div className="glass-soft h-64 animate-pulse rounded-2xl" />;

  const allGroups = groups?.groups ?? [];

  return (
    <div className="space-y-5">
      <h1 className="font-display text-2xl font-bold">My Space</h1>

      {/* Motion in Your School */}
      <section className="glass fade-up p-5">
        <h2 className="font-display flex items-center gap-2 text-lg font-bold">
          <GraduationCap size={19} className="text-gold" /> Motion in Your School
        </h2>
        <p className="mt-0.5 text-sm text-mist">{data.school}</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {data.classmates.length === 0 && <p className="text-sm text-mist">No classmates on Motion yet — invite them!</p>}
          {data.classmates.map((u) => (
            <div key={u.id} className="glass-soft flex items-center gap-3 p-3.5">
              <button onClick={() => openProfile(u.handle)}>
                <Avatar user={u} size={42} />
              </button>
              <div className="min-w-0 flex-1">
                <button onClick={() => openProfile(u.handle)} className="block truncate font-semibold hover:text-gold">{u.name}</button>
                <p className="truncate text-xs text-mist">{u.headline}</p>
              </div>
              <ConnectMessageButtons user={u} size="sm" onChange={load} />
            </div>
          ))}
        </div>

        <div className="mt-5 space-y-2">
          <h3 className="font-display flex items-center gap-2 text-sm font-bold text-mist">
            <Newspaper size={14} /> Campus news
          </h3>
          {data.news.map((n) => (
            <div key={n.id} className="glass-soft flex items-center justify-between gap-3 p-3 text-sm">
              <span>{n.title}</span>
              <Chip tone="ice">{n.tag}</Chip>
            </div>
          ))}
        </div>
      </section>

      {/* Saved & Calendar */}
      <section className="glass fade-up p-5">
        <h2 className="font-display flex items-center gap-2 text-lg font-bold">
          <CalendarDays size={19} className="text-gold" /> Saved Posts & Calendar
        </h2>
        <p className="mt-0.5 text-sm text-mist">Saving an opportunity auto-syncs it here.</p>

        {data.events.length === 0 ? (
          <p className="mt-4 text-sm text-mist">No upcoming events saved yet — tap "Save to Calendar" on any Pulse post.</p>
        ) : (
          <div className="mt-4 space-y-2.5">
            {data.events.map((e) => (
              <div key={e.postId} className="glass-soft flex flex-wrap items-center gap-3 p-4">
                <div className="flex h-12 w-12 flex-col items-center justify-center rounded-xl border border-gold/30 bg-gold-soft">
                  <span className="font-display text-lg font-bold leading-none text-gold">{new Date(e.date).getDate()}</span>
                  <span className="text-[10px] uppercase text-gold/80">{new Date(e.date).toLocaleDateString(undefined, { month: "short" })}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{e.title}</p>
                  <p className="text-xs text-mist">{eventDateLabel(e.date)} · {eventCountdown(e.date)}</p>
                  <p className="flex items-center gap-1 text-xs text-mist"><MapPin size={10} /> {e.location}</p>
                </div>
                <Chip tone={KIND_TONE[e.kind] ?? "gold"}>{e.kind}</Chip>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Communities */}
      <section className="glass fade-up p-5">
        <h2 className="font-display flex items-center gap-2 text-lg font-bold">
          <Users size={19} className="text-gold" /> Communities & Groups
        </h2>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {allGroups.length === 0 && <p className="text-sm text-mist">No groups yet — start the first one!</p>}
          {allGroups.map((g) => (
            <div key={g.id} className="glass-soft p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-display font-bold">{g.name}</p>
                  <p className="text-xs text-mist">{g.tag} · {g.memberCount} members{g.school ? ` · ${g.school}` : ""}</p>
                </div>
                {g.myRole ? (
                  <Chip tone={g.myRole === "admin" ? "gold" : g.myRole === "moderator" ? "ice" : "default"}>{g.myRole}</Chip>
                ) : (
                  <button onClick={() => groupAction(g.id, "join")} className="rounded-full bg-ice px-3.5 py-1.5 text-xs font-bold text-canvas hover:brightness-110">
                    Join
                  </button>
                )}
              </div>
              <p className="mt-2 text-sm text-mist">{g.description}</p>
              {g.myRole && (
                <button onClick={() => groupAction(g.id, "leave")} className="mt-2 text-xs text-mist underline-offset-2 hover:text-coral hover:underline">
                  Leave group
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

interface GroupsShape {
  groups: Array<{ id: string; name: string; tag: string; description: string; school: string | null; memberCount: number; myRole: string | null }>;
}
