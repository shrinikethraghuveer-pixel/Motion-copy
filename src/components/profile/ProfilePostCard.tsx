"use client";

import { useState } from "react";
import { Bookmark, Heart, MessageCircle, Repeat2 } from "lucide-react";
import { useUI } from "@/components/providers";
import type { ProfilePagePostRow } from "@/lib/db/schema-types";
import { togglePostLike, togglePostSaved } from "@/lib/db/profiles";
import { timeAgo } from "@/lib/utils";

/** Deterministic gradient art for posts (legacy store media or content hash). */
function artHue(seed: string): number {
  let a = 0;
  for (let i = 0; i < seed.length; i++) a = (a * 31 + seed.charCodeAt(i)) % 360;
  return a;
}

export default function ProfilePostCard({ post, onChange }: { post: ProfilePagePostRow; onChange: (p: ProfilePagePostRow) => void }) {
  const { toast } = useUI();
  return <PostCardInner post={post} onChange={onChange} toast={toast} />;
}

function PostCardInner({
  post,
  onChange,
  toast,
}: {
  post: ProfilePagePostRow;
  onChange: (p: ProfilePagePostRow) => void;
  toast: (t: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  const act = async (kind: "like" | "save") => {
    setBusy(true);
    try {
      onChange(kind === "like" ? await togglePostLike(post) : await togglePostSaved(post));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const author = post.profiles;
  const displayName = author?.display_name || author?.full_name || author?.username || "Student";
  const hue = artHue(post.media?.seed ?? post.id);

  return (
    <article className="light:bg-white/80 light:border-white/90 light:shadow-lg light:shadow-slate-300/50 dark:bg-zinc-900/60 dark:border-zinc-800/80 dark:shadow-none rounded-2xl border p-5 backdrop-blur-xl transition-colors hover:light:border-violet-200 dark:hover:border-zinc-700">
      <div className="flex items-start gap-3">
        <div className="light:border-slate-300/70 dark:border-zinc-700/70 mt-0.5 grid size-10 shrink-0 place-items-center overflow-hidden rounded-full border text-sm font-bold light:text-zinc-900 dark:text-white">
          {author?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={author.avatar_url} alt={displayName} className="h-full w-full object-cover" />
          ) : (
            <span
              style={{
                background: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 70) % 360} 70% 45%))`,
                color: "#0b1329",
              }}
              className="flex h-full w-full items-center justify-center"
            >
              {displayName.slice(0, 2).toUpperCase()}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 text-sm">
            <span className="font-semibold light:text-zinc-900 dark:text-zinc-100">{displayName}</span>
            <span className="text-xs light:text-zinc-500 dark:text-zinc-500">@{author?.username ?? "student"}</span>
            <span className="text-xs light:text-zinc-500 dark:text-zinc-500">· {timeAgo(post.created_at)}</span>
          </div>
          <p className="mt-1.5 whitespace-pre-wrap text-[15px] leading-relaxed light:text-zinc-700 dark:text-zinc-300">
            {post.content}
          </p>

          {post.media_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={post.media_url}
              alt=""
              className="light:border-slate-200 dark:border-zinc-700/60 mt-3 max-h-80 w-full rounded-xl border object-cover"
            />
          )}
          {post.media && (
            <div
              className="light:border-slate-200/80 dark:border-zinc-700/60 relative mt-3 h-48 overflow-hidden rounded-xl border"
              style={{
                background: `linear-gradient(120deg, hsl(${hue} 65% 45%), hsl(${(hue + 80) % 360} 70% 32%))`,
              }}
            >
              <span className="absolute bottom-2.5 left-4 text-xs font-medium text-white/85">{post.media.label}</span>
            </div>
          )}

          <div className="mt-3 flex items-center gap-1 text-xs light:text-zinc-500 dark:text-zinc-400">
            <button
              onClick={() => act("like")}
              disabled={busy}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 transition-colors hover:bg-rose-500/10 ${
                post.liked_by_me ? "text-rose-500" : "hover:text-rose-500"
              }`}
            >
              <Heart size={15} className={post.liked_by_me ? "fill-rose-500" : ""} />
              {post.likes_count > 0 && post.likes_count}
            </button>
            <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5">
              <MessageCircle size={15} /> {post.replies_count > 0 && post.replies_count}
            </span>
            <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5">
              <Repeat2 size={15} /> {post.reposts_count > 0 && post.reposts_count}
            </span>
            <button
              onClick={() => act("save")}
              disabled={busy}
              className={`ml-auto flex items-center gap-1.5 rounded-full px-2.5 py-1.5 transition-colors hover:bg-violet-500/10 ${
                post.saved_by_me ? "text-violet-600 dark:text-violet-400" : "hover:text-violet-600 dark:hover:text-violet-400"
              }`}
              title={post.saved_by_me ? "Saved" : "Save post"}
            >
              <Bookmark size={15} className={post.saved_by_me ? "fill-violet-600 dark:fill-violet-400" : ""} />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
