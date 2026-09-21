"use client";

import { useEffect, useState } from "react";
import {
  BarChart2,
  Calendar,
  Heart,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Repeat2,
  Send,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/shadcn/button";
import { Textarea } from "@/components/ui/shadcn/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/shadcn/tabs";
import { MOCK_POSTS } from "@/components/x/mock-data";
import { createPost, fetchFeedPosts, type FeedPost } from "@/lib/db/posts";
import { getCurrentUserSession, type SessionUser } from "@/lib/supabase/auth";
import { cn } from "@/lib/utils";

/** Normalized card shape for both live Supabase posts and mock posts. */
interface CardPost {
  id: string;
  name: string;
  handle: string;
  time: string;
  text: string;
  replies: number;
  reposts: number;
  likes: number;
  accent: string;
}

function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const ACCENTS = [
  "from-violet-500 to-indigo-500",
  "from-indigo-500 to-cyan-500",
  "from-cyan-500 to-violet-500",
  "from-violet-600 to-cyan-400",
  "from-indigo-400 to-violet-600",
];

function fromLive(post: FeedPost): CardPost {
  const name = post.profiles?.full_name || post.profiles?.username || "Student";
  const uname = post.profiles?.username ?? "student";
  return {
    id: post.id,
    name,
    handle: `@${uname}`,
    time: timeAgo(post.created_at),
    text: post.content,
    replies: post.replies_count,
    reposts: post.reposts_count,
    likes: post.likes_count,
    accent: ACCENTS[post.id.charCodeAt(0) % ACCENTS.length],
  };
}

function fromMock(post: (typeof MOCK_POSTS)[number]): CardPost {
  return { ...post };
}

function Composer({ session, onPosted }: { session: SessionUser | null; onPosted: (p: CardPost) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initials = session?.profile?.full_name
    ? session.profile.full_name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()
    : session?.profile?.username?.slice(0, 2).toUpperCase() ?? "YS";

  async function submit() {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createPost(text.trim());
      onPosted(fromLive(created));
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="x-glass flex gap-3 rounded-2xl p-4">
      <div className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-600 to-cyan-500 text-sm font-bold text-white">
        {initials}
        <span className="sr-only">Your avatar</span>
      </div>
      <div className="min-w-0 flex-1">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={session ? "What's your next motion?" : "Sign in to post to Motion"}
          className="min-h-16 resize-none border-0 bg-transparent px-0 text-[15px] focus-visible:ring-0 focus-visible:border-0"
        />
        <div className="mt-1 flex items-center justify-between border-t border-zinc-900/70 pt-2.5">
          <div className="flex items-center gap-1 text-cyan-300/90">
            <button className="rounded-full p-2 transition hover:bg-violet-500/15 hover:text-violet-300" aria-label="Add media">
              <ImageIcon size={18} />
            </button>
            <button className="rounded-full p-2 transition hover:bg-violet-500/15 hover:text-violet-300" aria-label="Add poll">
              <BarChart2 size={18} />
            </button>
            <button className="rounded-full p-2 transition hover:bg-violet-500/15 hover:text-violet-300" aria-label="Schedule event">
              <Calendar size={18} />
            </button>
            <button className="rounded-full p-2 transition hover:bg-violet-500/15 hover:text-violet-300" aria-label="Add sparkle">
              <Sparkles size={18} />
            </button>
          </div>
          <Button
            size="sm"
            className="rounded-full px-5 font-semibold"
            disabled={text.trim().length === 0 || busy}
            onClick={submit}
          >
            {busy ? <Loader2 className="animate-spin" /> : "Post"}
          </Button>
        </div>
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        {!session && <p className="mt-2 text-xs text-muted-foreground">Posting requires a Supabase session — use the Sign in dialog.</p>}
      </div>
    </div>
  );
}

function PostCard({ post, live }: { post: CardPost; live?: boolean }) {
  const [liked, setLiked] = useState(false);
  return (
    <article className="x-glass rounded-2xl p-4 transition-colors hover:bg-zinc-900/40" data-live={live ? "1" : undefined}>
      <div className="flex gap-3">
        <div className={cn("grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br text-sm font-bold text-white", post.accent)}>
          {post.name.split(" ").map((w) => w[0]).join("")}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm">
            <span className="font-bold text-foreground">{post.name}</span>
            <span className="text-muted-foreground">{post.handle}</span>
            <span className="text-muted-foreground">· {post.time}</span>
            <button className="ml-auto rounded-full p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground" aria-label="More">
              <MoreHorizontal size={16} />
            </button>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/95">
            {post.text}
          </p>
          <div className="mt-3 flex max-w-md items-center justify-between text-muted-foreground">
            <button className="group flex items-center gap-1.5 text-xs transition hover:text-cyan-300">
              <span className="rounded-full p-1.5 transition group-hover:bg-cyan-500/15"><MessageCircle size={16} /></span>
              {post.replies}
            </button>
            <button className="group flex items-center gap-1.5 text-xs transition hover:text-green-400">
              <span className="rounded-full p-1.5 transition group-hover:bg-green-500/15"><Repeat2 size={17} /></span>
              {post.reposts}
            </button>
            <button
              onClick={() => setLiked((v) => !v)}
              className={cn("group flex items-center gap-1.5 text-xs transition", liked ? "text-pink-500" : "hover:text-pink-500")}
            >
              <span className={cn("rounded-full p-1.5 transition group-hover:bg-pink-500/15", liked && "heart-pop")}>
                <Heart size={16} className={liked ? "fill-pink-500" : ""} />
              </span>
              {post.likes + (liked ? 1 : 0)}
            </button>
            <button className="group flex items-center gap-1.5 text-xs transition hover:text-violet-300">
              <span className="rounded-full p-1.5 transition group-hover:bg-violet-500/15"><Send size={15} /></span>
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

export function Feed() {
  const [tab, setTab] = useState<"foryou" | "following">("foryou");
  const [session, setSession] = useState<SessionUser | null>(null);
  const [livePosts, setLivePosts] = useState<CardPost[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    void getCurrentUserSession().then(setSession).catch(() => {});
    void fetchFeedPosts()
      .then((posts) => setLivePosts(posts.map(fromLive)))
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Feed unavailable"));
  }, []);

  const posts: CardPost[] =
    livePosts && livePosts.length > 0
      ? livePosts
      : MOCK_POSTS.map(fromMock);

  function handlePosted(p: CardPost) {
    setLivePosts((prev) => [p, ...(prev ?? [])]);
  }

  return (
    <div className="min-h-screen border-x border-zinc-900/60 pb-24">
      <header className="x-glass-strong sticky top-0 z-20 flex items-center justify-center border-x-0 py-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="foryou">For You</TabsTrigger>
            <TabsTrigger value="following">Following</TabsTrigger>
          </TabsList>
        </Tabs>
      </header>

      <div className="space-y-3 p-3 sm:p-4">
        <Composer session={session} onPosted={handlePosted} />
        {loadError && (
          <p className="x-glass rounded-xl p-3 text-xs text-muted-foreground">
            Live feed unavailable ({loadError}) — showing sample posts. Run <code className="text-cyan-300">supabase/migrations/0001_motion_init.sql</code> in the Supabase SQL Editor to go live.
          </p>
        )}
        {posts.map((post) => (
          <PostCard key={post.id} post={post} live={livePosts?.some((p) => p.id === post.id)} />
        ))}
      </div>
    </div>
  );
}

export default Feed;
