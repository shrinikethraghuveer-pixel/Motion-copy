"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { api, type FeedPost, type GroupsPayload } from "@/lib/client";
import { useUI } from "@/components/providers";
import PostCard from "@/components/feed/PostCard";
import { EmptyState } from "@/components/ui/primitives";

type FeedTab = "for-you" | "following" | "communities";
type Community = GroupsPayload["groups"][number];

const TABS: Array<{ key: FeedTab; label: string }> = [
  { key: "for-you", label: "For You" },
  { key: "following", label: "Following" },
  { key: "communities", label: "My Communities" },
];

export default function FeedView() {
  const { toast } = useUI();
  const [tab, setTab] = useState<FeedTab>("for-you");
  const [communityId, setCommunityId] = useState<string | null>(null);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);

  const loadCommunities = useCallback(async () => {
    try {
      const result = await api<GroupsPayload>("/api/groups");
      const joined = result.groups.filter((group) => group.myRole !== null);
      setCommunities(joined);
      setCommunityId((current) => current && joined.some((group) => group.id === current) ? current : joined[0]?.id ?? null);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Failed to load communities");
    }
  }, [toast]);

  const loadPosts = useCallback(async () => {
    try {
      const params = new URLSearchParams({ tab });
      if (tab === "communities" && communityId) params.set("community", communityId);
      const result = await api<{ posts: FeedPost[] }>(`/api/posts?${params}`);
      setPosts(result.posts);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Failed to load feed");
    } finally {
      setLoading(false);
    }
  }, [communityId, tab, toast]);

  useEffect(() => { void loadCommunities(); }, [loadCommunities]);

  useEffect(() => {
    setLoading(true);
    void loadPosts();
    const refresh = () => void loadPosts();
    window.addEventListener("motion:refresh", refresh);
    return () => window.removeEventListener("motion:refresh", refresh);
  }, [loadPosts]);

  const switchTab = (nextTab: FeedTab) => {
    setTab(nextTab);
    if (nextTab === "communities" && !communityId && communities[0]) setCommunityId(communities[0].id);
  };

  const emptyTitle = tab === "following" ? "Your following feed is quiet" : tab === "communities" ? "No community posts yet" : "Nothing here yet";
  const emptyHint = tab === "following" ? "Posts from your connected peers will appear here." : tab === "communities" ? "Join a community or try another group to see its builder updates." : "Be the first to share a project update.";

  return (
    <div className="relative mx-auto flex max-w-6xl flex-col gap-6 bg-slate-200/70 px-4 py-6 dark:bg-zinc-950">
      {/* self-start + w-fit: the bar hugs its tabs instead of stretching full-width */}
      <nav className="inline-flex w-fit max-w-full items-center gap-1 self-start overflow-x-auto rounded-xl border border-white/90 bg-white/80 p-1 shadow-lg shadow-slate-300/50 backdrop-blur-xl dark:border-zinc-800/80 dark:bg-zinc-900/60 dark:shadow-none" aria-label="Home feed filters">
        {TABS.map((item) => {
          const active = tab === item.key;
          return (
            <button
              key={item.key}
              onClick={() => switchTab(item.key)}
              aria-pressed={active}
              className={`relative shrink-0 rounded-lg px-3 py-1.5 text-sm transition-colors ${active ? "font-semibold text-violet-700 dark:text-violet-300" : "font-medium text-zinc-600 hover:bg-slate-100/80 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/40 dark:hover:text-zinc-100"}`}
            >
              {/* Sliding active pill — one shared layoutId glides between tabs */}
              {active && (
                <motion.span
                  layoutId="feed-tab-indicator"
                  transition={{ type: "spring", bounce: 0.25, duration: 0.5 }}
                  className="absolute inset-0 rounded-lg border border-slate-300/70 bg-white shadow-md dark:border-zinc-700/60 dark:bg-zinc-800/80 dark:shadow-none"
                  aria-hidden="true"
                />
              )}
              <span className="relative z-10">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {tab === "communities" && (
        <div className="flex flex-wrap gap-2" aria-label="My community filters">
          {communities.map((community) => (
            <button key={community.id} onClick={() => setCommunityId(community.id)} className={communityId === community.id ? "rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm shadow-violet-600/20" : "rounded-lg border border-slate-300/70 bg-slate-100/90 px-3 py-1.5 text-xs text-zinc-700 transition-colors hover:bg-slate-200/80 dark:border-zinc-700/60 dark:bg-zinc-800/50 dark:text-zinc-300 dark:hover:bg-zinc-800"}>
              #{community.tag.replace(/\s+/g, "")}
            </button>
          ))}
          {communities.length === 0 && <p className="px-1 py-1.5 text-xs text-zinc-500 dark:text-zinc-500">Join a community to personalize this feed.</p>}
        </div>
      )}

      <section className="flex flex-col gap-4" aria-live="polite">
        {loading ? <div className="h-64 animate-pulse rounded-2xl border border-white/90 bg-white/80 shadow-lg shadow-slate-300/50 dark:border-zinc-800/80 dark:bg-zinc-900/60 dark:shadow-none" /> : posts.length === 0 ? <EmptyState icon={<span className="text-3xl">⚡</span>} title={emptyTitle} hint={emptyHint} /> : posts.map((post) => <PostCard key={post.id} post={post} onChange={(updated) => setPosts((current) => current.map((post) => post.id === updated.id ? updated : post))} />)}
      </section>
    </div>
  );
}
