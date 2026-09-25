"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { api, post as apiPost, type FeedPost, type ProfilePayload } from "@/lib/client";
import type {
  FollowState,
  ProfilePageData,
  ProfilePagePostRow as ProfilePostRow,
  ProfileRow,
  ProfileStats,
} from "@/lib/db/schema-types";

/* =========================================================== constants */

/** Full profile row selector — 0001/0002 base columns + 0003 rich fields. */
const PROFILE_SELECT = "*";

/** Post rows with the author profile joined in. */
const POST_SELECT =
  "id, user_id, content, media_url, likes_count, reposts_count, replies_count, created_at, profiles:user_id (id, username, full_name, display_name, avatar_url)";

export class ProfileNotFoundError extends Error {
  constructor(username: string) {
    super(`No Motion profile found for @${username}`);
    this.name = "ProfileNotFoundError";
  }
}

function hasSupabaseEnv(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

function normalizeUsername(raw: string): string {
  return decodeURIComponent(raw).replace(/^@+/, "").trim();
}

/** True when the token looks like a user id ("u_zoe" / uuid) rather than a handle. */
function looksLikeId(token: string): boolean {
  return /^u_[\w-]+$/.test(token) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token);
}

/* ================================================================ read */

/**
 * Everything the /profile/[username] page renders, in one call.
 * Tries Supabase first; falls back to the legacy JSON-store APIs so the
 * whole app keeps working before `supabase/schema.sql` is applied.
 */
export async function fetchProfilePage(username: string): Promise<ProfilePageData> {
  const handle = normalizeUsername(username);
  if (!handle) throw new ProfileNotFoundError(username);

  if (hasSupabaseEnv()) {
    try {
      return await fetchFromSupabase(handle);
    } catch (e) {
      if (e instanceof ProfileNotFoundError) throw e;
      console.warn("[profile] Supabase unavailable — falling back to the local store:", e instanceof Error ? e.message : e);
    }
  }
  return fetchFromLocalStore(handle);
}

async function fetchFromSupabase(username: string): Promise<ProfilePageData> {
  const supabase = createClient();

  const { data: profile, error } = await supabase
    .from("profiles")
    .select(PROFILE_SELECT)
    // Handles and user ids both resolve — notification tiles navigate by id.
    .or(looksLikeId(username) ? `id.eq.${username},username.ilike.${username}` : `username.ilike.${username}`)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!profile) throw new ProfileNotFoundError(username);
  const row = profile as ProfileRow;

  const viewerId = await currentUserId(supabase);
  const isSelf = Boolean(viewerId) && viewerId === row.id;

  const { data: postRows, error: postsError } = await supabase
    .from("posts")
    .select(POST_SELECT)
    .eq("user_id", row.id)
    .order("created_at", { ascending: false });
  if (postsError) throw new Error(postsError.message);
  const posts = ((postRows ?? []) as unknown as ProfilePostRow[]).map((p) => ({
    ...p,
    media: null,
    saved_by_me: false,
  }));

  // Viewer-specific flags for the owner's posts.
  if (viewerId && posts.length > 0) {
    const postIds = posts.map((p) => p.id);
    const [{ data: likeRows }, { data: savedRows }] = await Promise.all([
      supabase.from("post_likes").select("post_id").eq("user_id", viewerId).in("post_id", postIds),
      supabase.from("saved_posts").select("post_id").eq("user_id", viewerId).in("post_id", postIds),
    ]);
    const likedSet = new Set((likeRows ?? []).map((l) => l.post_id as string));
    const savedSet = new Set((savedRows ?? []).map((s) => s.post_id as string));
    for (const p of posts) {
      p.liked_by_me = likedSet.has(p.id);
      p.saved_by_me = savedSet.has(p.id);
    }
  }

  // Activity / Likes tab — posts the profile owner recently liked.
  let liked: ProfilePostRow[] = [];
  const { data: likeActivity } = await supabase
    .from("post_likes")
    .select(`created_at, posts:post_id (${POST_SELECT})`)
    .eq("user_id", row.id)
    .order("created_at", { ascending: false })
    .limit(30);
  const likedPosts = ((likeActivity ?? []) as unknown as Array<{ posts: ProfilePostRow | null }>)
    .map((r) => r.posts)
    .filter((p): p is ProfilePostRow => Boolean(p));
  if (likedPosts.length > 0 && viewerId) {
    const { data: viewerLikes } = await supabase
      .from("post_likes")
      .select("post_id")
      .eq("user_id", viewerId)
      .in("post_id", likedPosts.map((p) => p.id));
    const viewerLiked = new Set((viewerLikes ?? []).map((l) => l.post_id as string));
    liked = likedPosts.map((p) => ({ ...p, liked_by_me: viewerLiked.has(p.id) }));
  } else {
    liked = likedPosts;
  }

  // Saved / Bookmarks — owner-only via RLS; only requested for self.
  let saved: ProfilePostRow[] = [];
  if (isSelf) {
    const { data: savedLinks } = await supabase
      .from("saved_posts")
      .select(`created_at, posts:post_id (${POST_SELECT})`)
      .eq("user_id", row.id)
      .order("created_at", { ascending: false });
    saved = ((savedLinks ?? []) as unknown as Array<{ posts: ProfilePostRow | null }>)
      .map((r) => r.posts)
      .filter((p): p is ProfilePostRow => Boolean(p))
      .map((p) => ({ ...p, media: null, saved_by_me: true }));
  }

  // Follower graph + follow state relative to the viewer.
  const [followersRes, followingRes, isFollowingRes, isFollowedByRes] = await Promise.all([
    supabase.from("follows").select("*", { count: "exact", head: true }).eq("following_id", row.id),
    supabase.from("follows").select("*", { count: "exact", head: true }).eq("follower_id", row.id),
    viewerId
      ? supabase.from("follows").select("follower_id").eq("follower_id", viewerId).eq("following_id", row.id).maybeSingle()
      : Promise.resolve({ data: null }),
    viewerId
      ? supabase.from("follows").select("following_id").eq("following_id", viewerId).eq("follower_id", row.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const stats: ProfileStats = {
    followers: followersRes.count ?? 0,
    following: followingRes.count ?? 0,
    projects: posts.length,
    upvotes: posts.reduce((n, p) => n + (p.likes_count ?? 0), 0),
  };
  const follow: FollowState = {
    followers: stats.followers,
    following: stats.following,
    isFollowing: Boolean((isFollowingRes as { data: unknown } | null)?.data),
    isFollowedBy: Boolean((isFollowedByRes as { data: unknown } | null)?.data),
  };

  return {
    profile: row,
    posts,
    liked,
    saved,
    stats,
    follow,
    isSelf,
    locked: false,
    source: "supabase",
    school: null,
    goal: row.goal ?? null,
    interests: row.interests ?? [],
  };
}

async function fetchFromLocalStore(handle: string): Promise<ProfilePageData> {
  const data = await api<ProfilePayload>(`/api/users/${encodeURIComponent(handle)}`);
  return mapLegacyToProfilePage(data);
}

/** Map the legacy /api/users/[handle] payload onto ProfilePageData. */
export function mapLegacyToProfilePage(data: ProfilePayload): ProfilePageData {
  const { user, stats } = data;
  const posts = data.posts.map(mapLegacyPost);
  return {
    profile: {
      id: user.id,
      username: user.handle,
      full_name: user.name,
      display_name: user.name,
      avatar_url: user.photo ?? null,
      bio: null,
      age: user.age ?? null,
      interests: [],
      goal: user.goal,
      feed_vibe: null,
      onboarding_completed: true,
      created_at: user.createdAt,
      cover_url: user.banner ?? null,
      banner_url: user.banner ?? null,
      headline: user.headline,
      location: user.school || null,
      website_url: null,
      github_url: null,
      linkedin_url: null,
      tech_stack: user.skills ?? [],
    },
    posts,
    liked: data.highlights.map(mapLegacyPost),
    saved: [],
    stats: {
      followers: stats.connections,
      following: stats.following,
      projects: stats.posts,
      upvotes: posts.reduce((n, p) => n + p.likes_count, 0),
    },
    follow: {
      followers: stats.connections,
      following: stats.following,
      isFollowing: user.connectionState === "connected",
      isFollowedBy: user.connectionState === "connected",
    },
    isSelf: user.isSelf,
    locked: data.locked ?? false,
    source: "local",
    school: user.school || null,
    goal: user.goal,
    interests: user.skills ?? [],
  };
}

function mapLegacyPost(p: FeedPost): ProfilePostRow {
  return {
    id: p.id,
    user_id: p.author.id,
    content: p.text,
    media_url: null,
    media: p.media ? { seed: p.media.seed, label: p.media.label } : null,
    likes_count: p.likes.length,
    reposts_count: p.reposts.length,
    replies_count: p.comments.length,
    created_at: p.createdAt,
    liked_by_me: p.likedByMe,
    saved_by_me: p.savedByMe,
    profiles: {
      id: p.author.id,
      username: p.author.handle,
      full_name: p.author.name,
      display_name: p.author.name,
      avatar_url: p.author.photo ?? null,
    },
  };
}

/* ============================================================= mutation */

/** Editable profile fields accepted by the Edit Profile modal. */
export interface ProfileUpdatePatch {
  display_name?: string;
  bio?: string | null;
  headline?: string | null;
  location?: string | null;
  website_url?: string | null;
  github_url?: string | null;
  linkedin_url?: string | null;
  tech_stack?: string[];
  avatar_url?: string | null;
  cover_url?: string | null;
  banner_url?: string | null;
}

/**
 * Persist an edit from the modal. Returns the fresh Supabase row, or null when
 * running on the legacy store (the caller keeps its optimistic state).
 */
export async function updateOwnProfile(patch: ProfileUpdatePatch): Promise<ProfileRow | null> {
  if (hasSupabaseEnv()) {
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in to edit your profile.");

      const bannerUrl = patch.banner_url !== undefined ? patch.banner_url : patch.cover_url;
      const { data, error } = await supabase
        .from("profiles")
        .update({
          display_name: patch.display_name,
          bio: patch.bio ?? null,
          headline: patch.headline ?? null,
          location: patch.location ?? null,
          website_url: patch.website_url ?? null,
          github_url: patch.github_url ?? null,
          linkedin_url: patch.linkedin_url ?? null,
          tech_stack: patch.tech_stack ?? [],
          ...(patch.avatar_url !== undefined ? { avatar_url: patch.avatar_url } : {}),
          ...(bannerUrl !== undefined ? { cover_url: bannerUrl, banner_url: bannerUrl } : {}),
        })
        .eq("id", user.id)
        .select(PROFILE_SELECT)
        .single();
      if (error) throw new Error(error.message);
      return data as ProfileRow;
    } catch (e) {
      console.warn("[profile] Supabase update failed — falling back to local settings:", e instanceof Error ? e.message : e);
    }
  }

  // Legacy store: name, headline, photo and skills are supported.
  const body: Record<string, unknown> = {};
  if (patch.display_name !== undefined) body.name = patch.display_name;
  if (patch.headline !== undefined) body.headline = patch.headline ?? "";
  if (patch.avatar_url !== undefined) body.photo = patch.avatar_url;
  if (patch.banner_url !== undefined || patch.cover_url !== undefined) body.banner = patch.banner_url ?? patch.cover_url;
  if (patch.tech_stack !== undefined) body.skills = patch.tech_stack;
  if (Object.keys(body).length > 0) {
    await api("/api/settings", { method: "PATCH", body: JSON.stringify(body) });
  }
  return null;
}

/**
 * Follow / unfollow. Returns fresh state on Supabase, or null when the caller
 * should re-fetch the whole page (legacy connection flow).
 */
export async function toggleFollow(
  username: string,
  isFollowing: boolean
): Promise<{ isFollowing: boolean; followers: number } | null> {
  const handle = normalizeUsername(username);

  if (hasSupabaseEnv()) {
    try {
      const supabase = createClient();
      const { data: target } = await supabase
        .from("profiles")
        .select("id")
        .or(looksLikeId(handle) ? `id.eq.${handle},username.ilike.${handle}` : `username.ilike.${handle}`)
        .maybeSingle();
      if (!target) throw new Error("Profile not found.");
      const targetId = (target as { id: string }).id;
      const viewerId = await currentUserId(supabase);
      if (!viewerId) throw new Error("Sign in to follow people.");
      if (viewerId === targetId) throw new Error("That's you.");

      if (isFollowing) {
        await supabase.from("follows").delete().eq("follower_id", viewerId).eq("following_id", targetId);
      } else {
        const { error } = await supabase.from("follows").insert({ follower_id: viewerId, following_id: targetId });
        if (error && error.code !== "23505") throw new Error(error.message); // ignore duplicates
      }
      const { count } = await supabase
        .from("follows")
        .select("*", { count: "exact", head: true })
        .eq("following_id", targetId);
      return { isFollowing: !isFollowing, followers: count ?? 0 };
    } catch (e) {
      console.warn("[profile] Supabase follow failed — using connections API:", e instanceof Error ? e.message : e);
    }
  }

  await apiPost<{ state: string }>("/api/connections", {
    targetHandle: handle,
    action: isFollowing ? "remove" : "connect",
  });
  return null;
}

/** Like / unlike a post. Returns the updated row for optimistic rendering. */
export async function togglePostLike(post: ProfilePostRow): Promise<ProfilePostRow> {
  if (hasSupabaseEnv()) {
    try {
      const supabase = createClient();
      const viewerId = await currentUserId(supabase);
      if (!viewerId) throw new Error("Sign in to react to posts.");
      if (post.liked_by_me) {
        await supabase.from("post_likes").delete().eq("post_id", post.id).eq("user_id", viewerId);
      } else {
        const { error } = await supabase.from("post_likes").insert({ post_id: post.id });
        if (error && error.code !== "23505") throw new Error(error.message);
      }
      const { count } = await supabase.from("post_likes").select("*", { count: "exact", head: true }).eq("post_id", post.id);
      return { ...post, likes_count: count ?? post.likes_count, liked_by_me: !post.liked_by_me };
    } catch (e) {
      console.warn("[profile] Supabase like failed — using posts API:", e instanceof Error ? e.message : e);
    }
  }

  const { post: updated } = await apiPost<{ post: FeedPost }>(`/api/posts/${post.id}`, { action: "like" });
  return mapLegacyPost(updated);
}

/** Save / unsave a post (bookmarks). Returns the updated row. */
export async function togglePostSaved(post: ProfilePostRow): Promise<ProfilePostRow> {
  if (hasSupabaseEnv()) {
    try {
      const supabase = createClient();
      const viewerId = await currentUserId(supabase);
      if (!viewerId) throw new Error("Sign in to save posts.");
      if (post.saved_by_me) {
        await supabase.from("saved_posts").delete().eq("post_id", post.id).eq("user_id", viewerId);
      } else {
        const { error } = await supabase.from("saved_posts").insert({ post_id: post.id });
        if (error && error.code !== "23505") throw new Error(error.message);
      }
      return { ...post, saved_by_me: !post.saved_by_me };
    } catch (e) {
      console.warn("[profile] Supabase save failed — using posts API:", e instanceof Error ? e.message : e);
    }
  }

  const { post: updated } = await apiPost<{ post: FeedPost }>(`/api/posts/${post.id}`, { action: "save" });
  return mapLegacyPost(updated);
}

/* ============================================================== uploads */

/** Upload to the `avatars` / `banners` storage buckets; returns a public URL. */
export async function uploadProfileImage(file: File, kind: "avatar" | "cover"): Promise<string> {
  if (!hasSupabaseEnv()) {
    if (kind === "cover") {
      throw new Error("Cover photos need Supabase storage — run supabase/schema.sql to enable them.");
    }
    return fileToDataUrl(file); // legacy store keeps small data URLs on the user row
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in to upload images.");

  const ext = (file.name.split(".").pop() ?? "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 8) || "jpg";
  const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const bucket = kind === "avatar" ? "avatars" : "banners";

  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: "3600",
    contentType: file.type,
    upsert: false,
  });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

/** Upload a composer attachment to the public post-media bucket. */
export async function uploadPostMedia(file: File): Promise<string> {
  if (!hasSupabaseEnv()) {
    if (file.size > 2_000_000) throw new Error("Local post attachments must be under 2 MB.");
    return fileToDataUrl(file);
  }
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in to attach media.");
  const ext = (file.name.split(".").pop() ?? "bin").replace(/[^a-z0-9]/gi, "").slice(0, 8) || "bin";
  const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from("post-media").upload(path, file, {
    cacheControl: "3600",
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return supabase.storage.from("post-media").getPublicUrl(path).data.publicUrl;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Couldn't read that image."));
    reader.readAsDataURL(file);
  });
}

/* ============================================================== helpers */

async function currentUserId(supabase: SupabaseClient): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}
