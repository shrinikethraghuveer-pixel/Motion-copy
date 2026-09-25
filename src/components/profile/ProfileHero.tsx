"use client";

import { useMemo } from "react";
import {
  CalendarDays,
  Github,
  Globe,
  Linkedin,
  MapPin,
  MessageCircle,
  Pencil,
  UserCheck,
  UserPlus,
} from "lucide-react";
import type { ProfilePageData } from "@/lib/db/schema-types";
import { gradientFor, initialsOf } from "@/lib/utils";

/** Shared dual-theme liquid-glass card token (strict light:/dark: pairing). */
export const GLASS_CARD =
  "light:bg-white/80 light:border-white/90 light:shadow-xl light:shadow-slate-300/50 " +
  "dark:bg-zinc-900/60 dark:border-zinc-800/80 dark:shadow-none rounded-2xl backdrop-blur-xl";

/** Compact tech-stack pill token. */
export const TAG_PILL =
  "light:bg-slate-100 dark:bg-zinc-800/60 light:border-slate-200 dark:border-zinc-700/50 " +
  "light:text-zinc-700 dark:text-zinc-300 text-xs px-2.5 py-1 rounded-md border";

export function ProfileAvatar({
  user,
  className = "",
}: {
  user: { id: string; name: string; avatar_url?: string | null };
  className?: string;
}) {
  if (user.avatar_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={user.avatar_url} alt={user.name} className={`aspect-square rounded-full object-cover ${className}`} />
    );
  }
  const { from, to } = gradientFor(user.id);
  return (
    <span
      aria-hidden="true"
      className={`aspect-square flex items-center justify-center rounded-full font-bold ${className}`}
      style={{
        background: `linear-gradient(135deg, hsl(${from} 70% 55%), hsl(${to} 70% 45%))`,
        color: "#0b1329",
        fontSize: "1.5rem",
      }}
    >
      {initialsOf(user.name)}
    </span>
  );
}

interface ProfileHeroProps {
  data: ProfilePageData;
  busy: boolean;
  onEdit: () => void;
  onToggleFollow: () => void;
  onMessage: () => void;
}

export default function ProfileHero({ data, busy, onEdit, onToggleFollow, onMessage }: ProfileHeroProps) {
  const { profile, stats, follow, isSelf } = data;
  const displayName = profile.display_name || profile.full_name || profile.username;
  const headline = profile.headline || data.goal || "";
  const bannerUrl = profile.banner_url || profile.cover_url;

  const joined = useMemo(() => {
    const d = new Date(profile.created_at);
    return Number.isNaN(d.getTime())
      ? null
      : d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }, [profile.created_at]);

  const techStack = profile.tech_stack ?? [];

  return (
    <section className={`${GLASS_CARD} relative overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300`}>
      {/* ── A. Cover banner ─────────────────────────────────────────────── */}
      <div className="light:bg-gradient-to-r light:from-violet-600/30 light:to-cyan-500/30 dark:from-violet-600/25 dark:to-cyan-500/25 dark:bg-gradient-to-r relative h-44 w-full sm:h-56">
        {bannerUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={bannerUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <>
            <span className="pointer-events-none absolute -right-14 -top-16 h-52 w-52 rounded-full bg-violet-500/20 blur-3xl" />
            <span className="pointer-events-none absolute -bottom-20 left-16 h-52 w-52 rounded-full bg-cyan-400/15 blur-3xl" />
          </>
        )}
      </div>

      {/* ── B. Avatar + primary action bar (overlap row) ────────────────── */}
      <div className="relative flex items-end justify-between px-6 pt-3">
        <div className="absolute -top-12 left-6">
          <ProfileAvatar
            user={{ id: profile.id, name: displayName, avatar_url: profile.avatar_url }}
            className="light:ring-slate-200/70 dark:ring-zinc-950 h-24 w-24 shadow-lg ring-4 sm:h-28 sm:w-28"
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
          {isSelf ? (
            <button
              onClick={onEdit}
              className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-md shadow-violet-600/20 transition-all hover:bg-violet-700"
            >
              <Pencil size={14} /> Edit Profile
            </button>
          ) : (
            <>
              <button
                onClick={onToggleFollow}
                disabled={busy}
                className={
                  follow.isFollowing
                    ? "inline-flex items-center gap-1.5 rounded-xl border border-slate-300/80 bg-white/80 px-4 py-2 text-sm font-semibold text-zinc-800 transition-all hover:border-rose-300 hover:text-rose-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800/80 dark:text-zinc-200 dark:hover:border-rose-500/40"
                    : "inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-violet-700 disabled:opacity-60"
                }
              >
                {follow.isFollowing ? <UserCheck size={14} /> : <UserPlus size={14} />}
                {follow.isFollowing ? "Following" : "Connect"}
              </button>
              <button
                onClick={onMessage}
                aria-label="Direct message"
                title="Direct message"
                className="light:bg-white/80 dark:bg-zinc-800/80 light:border-slate-300/80 dark:border-zinc-700 light:text-zinc-800 dark:text-zinc-200 hover:text-violet-500 rounded-xl border p-2 transition-all"
              >
                <MessageCircle size={16} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── C. Identity, metadata & metrics ─────────────────────────────── */}
      <div className="px-6 pb-6 pt-4 sm:pt-6">
        {follow.isFollowedBy && !isSelf && (
          <span className="light:bg-slate-100 dark:bg-zinc-800/60 light:text-zinc-500 dark:text-zinc-400 mb-2 inline-block rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
            Follows you
          </span>
        )}
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold light:text-zinc-900 dark:text-zinc-100">
          {displayName}
        </h1>
        <p className="font-mono text-sm light:text-zinc-500 dark:text-zinc-400">@{profile.username}</p>

        {headline && (
          <p className="mt-1 text-sm font-medium light:text-zinc-700 dark:text-zinc-300">{headline}</p>
        )}
        {profile.bio && (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed light:text-zinc-600 dark:text-zinc-400">{profile.bio}</p>
        )}

        {/* Social & location metadata */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs light:text-zinc-500 dark:text-zinc-500">
          {profile.location && (
            <span className="inline-flex items-center gap-1">
              <MapPin size={12} /> {profile.location}
            </span>
          )}
          {profile.website_url && (
            <a
              href={profile.website_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 transition-colors hover:text-violet-600 dark:hover:text-violet-400"
            >
              <Globe size={12} /> {profile.website_url.replace(/^https?:\/\//, "")}
            </a>
          )}
          {profile.github_url && (
            <a
              href={profile.github_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 transition-colors hover:text-violet-600 dark:hover:text-violet-400"
            >
              <Github size={12} /> GitHub
            </a>
          )}
          {profile.linkedin_url && (
            <a
              href={profile.linkedin_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 transition-colors hover:text-violet-600 dark:hover:text-violet-400"
            >
              <Linkedin size={12} /> LinkedIn
            </a>
          )}
          {joined && (
            <span className="inline-flex items-center gap-1">
              <CalendarDays size={12} /> Joined {joined}
            </span>
          )}
        </div>

        {/* Tech stack badges */}
        {techStack.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {techStack.map((tag) => (
              <span key={tag} className={TAG_PILL}>
                #{tag.replace(/\s+/g, "")}
              </span>
            ))}
          </div>
        )}

        {/* Follower / connection counter bar */}
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <span>
            <b className="font-bold light:text-zinc-900 dark:text-zinc-100">{stats.followers}</b>{" "}
            <span className="text-xs light:text-zinc-500 dark:text-zinc-500">Followers</span>
          </span>
          <span>
            <b className="font-bold light:text-zinc-900 dark:text-zinc-100">{stats.following}</b>{" "}
            <span className="text-xs light:text-zinc-500 dark:text-zinc-500">Following</span>
          </span>
          <span>
            <b className="font-bold light:text-zinc-900 dark:text-zinc-100">{stats.projects}</b>{" "}
            <span className="text-xs light:text-zinc-500 dark:text-zinc-500">Motion Projects</span>
          </span>
          <span>
            <b className="font-bold light:text-zinc-900 dark:text-zinc-100">{stats.upvotes}</b>{" "}
            <span className="text-xs light:text-zinc-500 dark:text-zinc-500">Upvotes Received</span>
          </span>
        </div>
      </div>
    </section>
  );
}
