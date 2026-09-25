"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Activity, Bookmark, FolderOpen } from "lucide-react";
import {
  fetchProfilePage,
  toggleFollow,
  updateOwnProfile,
  ProfileNotFoundError,
  type ProfileUpdatePatch,
} from "@/lib/db/profiles";
import type { ProfilePageData, ProfilePagePostRow } from "@/lib/db/schema-types";
import { useSession, useUI } from "@/components/providers";
import ProfileHero, { GLASS_CARD, TAG_PILL } from "@/components/profile/ProfileHero";
import ProfilePostCard from "@/components/profile/ProfilePostCard";
import EditProfileModal from "@/components/profile/EditProfileModal";
import { EmptyState } from "@/components/ui/primitives";

type Tab = "posts" | "activity" | "about" | "saved";

/** Outer canvas: cool grey-slate in light, obsidian zinc in dark. */
const CANVAS = "light:bg-slate-200/70 dark:bg-zinc-950";

const TABS: Array<{ key: Tab; label: string; selfOnly?: boolean }> = [
  { key: "posts", label: "Projects & Posts" },
  { key: "activity", label: "Activity / Likes" },
  { key: "about", label: "About / Skills" },
  { key: "saved", label: "Saved / Bookmarks", selfOnly: true },
];

export default function UserProfilePage() {
  const params = useParams<{ username: string }>();
  const username = useMemo(() => ((Array.isArray(params.username) ? params.username[0] : params.username) ?? "").replace(/^@+/, ""), [params]);
  const router = useRouter();
  const { toast } = useUI();
  const { me, refresh: refreshSession } = useSession();

  const [data, setData] = useState<ProfilePageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<Tab>("posts");
  const [editOpen, setEditOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  /* ── Load profile (Supabase → legacy fallback) ─────────────────────── */
  const load = useCallback(async () => {
    if (!username) return;
    setLoading(true);
    setErr(null);
    setNotFound(false);
    try {
      const payload = await fetchProfilePage(username);
      setData(payload);
    } catch (e) {
      if (e instanceof ProfileNotFoundError) setNotFound(true);
      else setErr(e instanceof Error ? e.message : "Couldn't load this profile.");
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => {
    void load();
  }, [load]);

  // Recover the signed-in user's missing profile through onboarding. Unknown
  // handles belonging to other users still show the normal not-found state.
  useEffect(() => {
    if (!loading && (notFound || (data && !data.profile.username)) && me && username.toLowerCase() === me.handle.toLowerCase()) {
      router.replace("/onboarding");
    }
  }, [data, loading, me, notFound, router, username]);

  const needsOnboarding = Boolean(
    !loading &&
      (notFound || (data && !data.profile.username)) &&
      me &&
      username.toLowerCase() === me.handle.toLowerCase()
  );

  useEffect(() => {
    const h = () => void load();
    window.addEventListener("motion:refresh", h);
    return () => window.removeEventListener("motion:refresh", h);
  }, [load]);

  /* ── Edit profile (own only) ───────────────────────────────────────── */
  const handleSaved = useCallback(
    async (patch: ProfileUpdatePatch, fresh: Awaited<ReturnType<typeof updateOwnProfile>>) => {
      setEditOpen(false);
      toast("Profile updated");
      if (fresh) {
        setData((current) => (current ? { ...current, profile: fresh } : current));
      } else {
        await load(); // legacy store: re-fetch authoritative state
      }
      void refreshSession();
    },
    [load, refreshSession, toast]
  );

  /* ── Follow / unfollow ─────────────────────────────────────────────── */
  const handleToggleFollow = useCallback(async () => {
    if (!data || data.isSelf) return;
    setBusy(true);
    try {
      const result = await toggleFollow(data.profile.username, data.follow.isFollowing);
      if (result) {
        setData((current) =>
          current
            ? {
                ...current,
                follow: { ...current.follow, isFollowing: result.isFollowing, followers: result.followers },
                stats: { ...current.stats, followers: result.followers },
              }
            : current
        );
      } else {
        await load(); // legacy connection flow — re-fetch authoritative state
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't update follow state");
    } finally {
      setBusy(false);
    }
  }, [data, load, toast]);

  /* ── Direct message → pre-targeted chat ────────────────────────────── */
  const handleMessage = useCallback(() => {
    router.push(`/chat?to=${encodeURIComponent(data?.profile.username ?? "")}`);
  }, [data, router]);

  const updatePost = useCallback((updated: ProfilePagePostRow) => {
    setData((current) => {
      if (!current) return current;
      const patchList = (list: ProfilePagePostRow[]) => list.map((p) => (p.id === updated.id ? updated : p));
      return {
        ...current,
        posts: patchList(current.posts),
        liked: patchList(current.liked),
        saved: patchList(current.saved),
      };
    });
  }, []);

  /* ── Render: loading / error / locked / not-found ──────────────────── */
  if (loading && !data) {
    return (
      <div className={`${CANVAS} relative mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl flex-col gap-6 px-4 py-6`}>
        <div className="light:bg-white/80 dark:bg-zinc-900/60 h-80 animate-pulse rounded-2xl" />
        <div className="light:bg-white/80 dark:bg-zinc-900/60 h-40 animate-pulse rounded-2xl" />
      </div>
    );
  }

  if (needsOnboarding) return null;

  if (notFound || !data) {
    return (
      <div className={`${CANVAS} mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl flex-col px-4 py-10`}>
        <div className="light:bg-white/80 light:border-white/90 light:shadow-xl light:shadow-slate-300/50 dark:bg-zinc-900/60 dark:border-zinc-800/80 dark:shadow-none rounded-2xl border p-10 text-center backdrop-blur-xl">
          <span className="text-4xl">👻</span>
          <h1 className="mt-3 text-xl font-bold light:text-zinc-900 dark:text-zinc-100">Profile not found</h1>
          <p className="mt-1 text-sm light:text-zinc-500 dark:text-zinc-400">
            No Motion account matches @{username}. They may have changed their handle.
          </p>
        </div>
      </div>
    );
  }

  if (err) {
    return (
      <div className={`${CANVAS} mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl flex-col px-4 py-10`}>
        <div className="light:bg-white/80 light:border-white/90 light:shadow-xl light:shadow-slate-300/50 dark:bg-zinc-900/60 dark:border-zinc-800/80 dark:shadow-none rounded-2xl border p-10 text-center backdrop-blur-xl">
          <h1 className="text-xl font-bold light:text-zinc-900 dark:text-zinc-100">Something went wrong</h1>
          <p className="mt-1 text-sm light:text-zinc-500 dark:text-zinc-400">{err}</p>
        </div>
      </div>
    );
  }

  if (data.locked) {
    return (
      <div className={`${CANVAS} mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl flex-col px-4 py-10`}>
        <div className="light:bg-white/80 light:border-white/90 light:shadow-xl light:shadow-slate-300/50 dark:bg-zinc-900/60 dark:border-zinc-800/80 dark:shadow-none rounded-2xl border p-10 text-center backdrop-blur-xl">
          <span className="text-4xl">🔒</span>
          <h1 className="mt-3 text-xl font-bold light:text-zinc-900 dark:text-zinc-100">This profile is private</h1>
          <p className="mt-1 text-sm light:text-zinc-500 dark:text-zinc-400">
            Connect with @{data.profile.username} to see their projects and activity.
          </p>
        </div>
      </div>
    );
  }

  const p = data.profile;
  const visibleTabs = TABS.filter((t) => !t.selfOnly || data.isSelf);

  return (
    <div className={`${CANVAS} relative mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl flex-col gap-6 px-4 py-6`}>
      {/* ── Hero: banner + avatar + identity + metrics ──────────────────── */}
      <ProfileHero data={data} busy={busy} onEdit={() => setEditOpen(true)} onToggleFollow={handleToggleFollow} onMessage={handleMessage} />

      {/* ── Tab bar ─────────────────────────────────────────────────────── */}
      <nav
        className="light:bg-white/70 light:border-slate-300/70 dark:bg-zinc-900/50 dark:border-zinc-800/70 flex flex-wrap gap-2 rounded-xl border p-1 backdrop-blur-md"
        aria-label="Profile sections"
      >
        {visibleTabs.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "rounded-lg bg-violet-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm shadow-violet-600/20"
                  : "light:text-zinc-600 dark:text-zinc-400 light:hover:text-zinc-900 dark:hover:text-zinc-100 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors"
              }
            >
              {t.label}
              {t.key === "posts" && data.posts.length > 0 && <span className="ml-1.5 text-xs opacity-70">{data.posts.length}</span>}
            </button>
          );
        })}
        {data.isSelf && <span className="sr-only">Bookmarks visible to you only</span>}
      </nav>

      {/* ── Tab content ─────────────────────────────────────────────────── */}
      <section aria-live="polite" className="flex flex-col gap-4">
        {tab === "posts" &&
          (data.posts.length === 0 ? (
            <EmptyState
              icon={<FolderOpen size={26} />}
              title="No projects yet"
              hint={data.isSelf ? "Share your first motion from the composer." : "When they post, it lands here."}
            />
          ) : (
            data.posts.map((post) => <ProfilePostCard key={post.id} post={post} onChange={updatePost} />)
          ))}

        {tab === "activity" &&
          (data.liked.length === 0 ? (
            <EmptyState icon={<Activity size={26} />} title="No activity yet" hint="Likes and reposts show up here." />
          ) : (
            data.liked.map((post) => <ProfilePostCard key={`liked-${post.id}`} post={post} onChange={updatePost} />)
          ))}

        {tab === "about" && (
          <div className={`${GLASS_CARD} p-6`}>
            <h2 className="text-lg font-bold light:text-zinc-900 dark:text-zinc-100">About</h2>
            <p className="mt-2 text-sm leading-relaxed light:text-zinc-600 dark:text-zinc-400">{p.bio || "No bio yet."}</p>

            <h3 className="mt-6 text-sm font-bold uppercase tracking-wide light:text-zinc-500 dark:text-zinc-400">Tech stack</h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(p.tech_stack && p.tech_stack.length > 0 ? p.tech_stack : ["Not added yet"]).map((tag) => (
                <span key={tag} className={TAG_PILL}>
                  #{tag.replace(/\s+/g, "")}
                </span>
              ))}
            </div>

            <h3 className="mt-6 text-sm font-bold uppercase tracking-wide light:text-zinc-500 dark:text-zinc-400">Links & details</h3>
            <ul className="mt-2 space-y-2 text-sm">
              {data.school && (
                <li className="light:text-zinc-600 dark:text-zinc-400">
                  <b className="light:text-zinc-900 dark:text-zinc-100">Campus:</b> {data.school}
                </li>
              )}
              {p.location && (
                <li className="light:text-zinc-600 dark:text-zinc-400">
                  <b className="light:text-zinc-900 dark:text-zinc-100">Location:</b> {p.location}
                </li>
              )}
              {p.website_url && (
                <li>
                  <a href={p.website_url} target="_blank" rel="noopener noreferrer" className="text-violet-600 hover:underline dark:text-violet-400">
                    {p.website_url.replace(/^https?:\/\//, "")}
                  </a>
                </li>
              )}
              {p.github_url && (
                <li>
                  <a href={p.github_url} target="_blank" rel="noopener noreferrer" className="text-violet-600 hover:underline dark:text-violet-400">
                    GitHub — {p.github_url.replace(/^https?:\/\//, "")}
                  </a>
                </li>
              )}
              {p.linkedin_url && (
                <li>
                  <a href={p.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-violet-600 hover:underline dark:text-violet-400">
                    LinkedIn — {p.linkedin_url.replace(/^https?:\/\//, "")}
                  </a>
                </li>
              )}
              <li className="light:text-zinc-600 dark:text-zinc-400">
                <b className="light:text-zinc-900 dark:text-zinc-100">Joined:</b>{" "}
                {new Date(p.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
              </li>
            </ul>
          </div>
        )}

        {tab === "saved" &&
          data.isSelf &&
          (data.saved.length === 0 ? (
            <EmptyState
              icon={<Bookmark size={26} />}
              title="Nothing saved yet"
              hint="Bookmark posts to find them here — only you can see this tab."
            />
          ) : (
            data.saved.map((post) => <ProfilePostCard key={`saved-${post.id}`} post={post} onChange={updatePost} />)
          ))}
      </section>

      {/* ── Inline Edit Profile modal (own profile) ─────────────────────── */}
      {editOpen && data.isSelf && <EditProfileModal profile={p} onClose={() => setEditOpen(false)} onSaved={handleSaved} />}

      {/* FloatingChatWidget renders globally from the root layout — bottom-right, z-[9999]. */}
    </div>
  );
}
