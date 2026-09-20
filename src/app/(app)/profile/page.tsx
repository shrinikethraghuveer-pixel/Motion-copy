"use client";

import { useCallback, useEffect, useState } from "react";
import { Award, FileText, Layers, Users } from "lucide-react";
import { api, post, type ProfilePayload } from "@/lib/client";
import { useUI } from "@/components/providers";
import ProfileHeaderCard from "@/components/profile/ProfileHeaderCard";
import PostCard from "@/components/feed/PostCard";
import { Chip, EmptyState } from "@/components/ui/primitives";

type Tab = "posts" | "highlights" | "clubs";

export default function MyProfilePage() {
  const { openProfile, toast } = useUI();
  const [data, setData] = useState<ProfilePayload | null>(null);

  const load = useCallback(async () => {
    try {
      const me = await api<{ user: { handle: string } }>("/api/session");
      setData(await api<ProfilePayload>(`/api/users/${me.user.handle}`));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to load profile");
    }
  }, [toast]);

  useEffect(() => {
    load();
    const h = () => load();
    window.addEventListener("motion:refresh", h);
    return () => window.removeEventListener("motion:refresh", h);
  }, [load]);

  if (!data) return <div className="glass-soft h-64 animate-pulse rounded-2xl" />;

  const visibleTabs = ([
    { key: "posts", label: "Posts", icon: FileText, count: data.posts.length },
    { key: "highlights", label: "Highlights", icon: Award, count: data.highlights.length },
    { key: "clubs", label: "Clubs", icon: Users, count: data.clubs.length },
  ] as Array<{ key: Tab; label: string; icon: typeof Users; count: number }>).filter((t) => t.count > 0); // empty tabs auto-hide

  return (
    <div className="space-y-4">
      <ProfileHeaderCard data={data} />

      {/* Skills & Focus — auto-collapse when empty */}
      {data.user.skills.length > 0 && (
        <section className="glass fade-up p-5">
          <h2 className="font-display mb-3 text-sm font-bold uppercase tracking-wide text-mist">Skills & Focus</h2>
          <div className="flex flex-wrap gap-2">
            {data.user.skills.map((s) => (
              <Chip key={s} tone="gold">{s}</Chip>
            ))}
          </div>
        </section>
      )}

      {visibleTabs.length > 0 && (
        <div className="liquid-track self-start">
          {visibleTabs.map((t, i) => (
            <button key={t.key} className={`relative rounded-full px-5 py-1.5 text-sm font-semibold ${i === 0 ? "text-gold" : "text-mist hover:text-ink"}`}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {data.posts.map((p) => (
        <PostCard key={p.id} post={p} onChange={() => load()} />
      ))}

      {data.posts.length === 0 && (
        <EmptyState icon={<Layers size={26} />} title="No posts yet" hint="Your portfolio starts with the first share." />
      )}
    </div>
  );
}
