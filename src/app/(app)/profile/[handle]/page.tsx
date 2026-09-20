"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, type ProfilePayload } from "@/lib/client";
import { useUI } from "@/components/providers";
import ProfileHeaderCard from "@/components/profile/ProfileHeaderCard";
import PostCard from "@/components/feed/PostCard";
import { Chip, EmptyState } from "@/components/ui/primitives";

export default function UserProfilePage() {
  const { handle } = useParams<{ handle: string }>();
  const { toast } = useUI();
  const [data, setData] = useState<ProfilePayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<ProfilePayload>(`/api/users/${handle}`));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Profile not found");
    }
  }, [handle, toast]);

  useEffect(() => {
    load();
  }, [load]);

  if (err) return <EmptyState icon={<span className="text-2xl">👻</span>} title="Profile not found" hint={err} />;
  if (!data) return <div className="glass-soft h-64 animate-pulse rounded-2xl" />;

  const clubs = data.clubs.length > 0 && (
    <section className="glass p-5">
      <h2 className="font-display mb-3 text-sm font-bold uppercase tracking-wide text-mist">Clubs</h2>
      <div className="flex flex-wrap gap-2">
        {data.clubs.map((c) => (
          <Chip key={c.id} tone="ice">{c.name} · {c.role}</Chip>
        ))}
      </div>
    </section>
  );

  return (
    <div className="space-y-4">
      <ProfileHeaderCard data={data} />
      {data.user.skills.length > 0 && (
        <section className="glass p-5">
          <h2 className="font-display mb-3 text-sm font-bold uppercase tracking-wide text-mist">Skills & Focus</h2>
          <div className="flex flex-wrap gap-2">
            {data.user.skills.map((s) => (
              <Chip key={s} tone="gold">{s}</Chip>
            ))}
          </div>
        </section>
      )}
      {clubs}
      {data.posts.map((p) => (
        <PostCard key={p.id} post={p} onChange={() => load()} />
      ))}
      {data.posts.length === 0 && <EmptyState icon={<span className="text-2xl">📭</span>} title="No posts yet" />}
    </div>
  );
}
