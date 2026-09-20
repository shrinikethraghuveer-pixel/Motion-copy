"use client";

import { useCallback, useEffect, useState } from "react";
import { Filter } from "lucide-react";
import { api, type FeedPost } from "@/lib/client";
import { INTEREST_FILTERS } from "@/lib/schema";
import { useUI } from "@/components/providers";
import PostCard from "@/components/feed/PostCard";
import ComposerModal from "@/components/feed/ComposerModal";
import { EmptyState } from "@/components/ui/primitives";

export default function FeedView({ initialTab = "for-you" }: { initialTab?: "for-you" | "circle" }) {
  const { openComposer, toast } = useUI();
  const [tab, setTab] = useState<"for-you" | "circle">(initialTab);
  const [filter, setFilter] = useState<string | null>(null);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ tab });
      if (filter) params.set("tag", filter);
      const r = await api<{ posts: FeedPost[] }>(`/api/posts?${params}`);
      setPosts(r.posts);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to load feed");
    } finally {
      setLoading(false);
    }
  }, [tab, filter, toast]);

  useEffect(() => {
    setLoading(true);
    load();
    const onFocus = () => load();
    window.addEventListener("motion:refresh", onFocus);
    return () => window.removeEventListener("motion:refresh", onFocus);
  }, [load]);

  const tabs: Array<{ key: "for-you" | "circle"; label: string }> = [
    { key: "for-you", label: "For You" },
    { key: "circle", label: "Your Circle" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="liquid-track">
          <span className="liquid-thumb" style={{ left: tab === "for-you" ? 4 : "50%", width: "calc(50% - 6px)" }} />
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`relative rounded-full px-6 py-1.5 text-sm font-semibold transition ${tab === t.key ? "text-gold" : "text-mist hover:text-ink"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => setFilter(filter === null ? "Coding" : null)}
          className={`glass-pill flex items-center gap-1.5 px-4 py-1.5 text-sm transition ${filter ? "text-gold" : "text-mist hover:text-ink"}`}
        >
          <Filter size={14} /> {filter ?? "Filter"}
        </button>
      </div>

      {loading ? (
        <div className="glass-soft h-64 animate-pulse rounded-2xl" />
      ) : posts.length === 0 ? (
        <EmptyState
          icon={<span className="text-3xl">⚡</span>}
          title={tab === "circle" ? "Your Circle is quiet" : "Nothing here yet"}
          hint={tab === "circle" ? "Connect with peers and their posts will show up here." : "Be the first to post something."}
        />
      ) : (
        posts.map((p) => <PostCard key={p.id} post={p} onChange={(np) => setPosts((ps) => ps.map((x) => (x.id === np.id ? np : x)))} />)
      )}

      {composerOpen && <ComposerModal onClose={() => setComposerOpen(false)} onPosted={(p) => setPosts((ps) => [p, ...ps])} />}
    </div>
  );
}
