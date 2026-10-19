"use client";

import { createClient } from "@/lib/supabase/client";
import { validateOptionalUrl } from "@/lib/url-validation";
import type { Profile } from "@/lib/supabase/auth";

/** A feed post with its author's public profile joined in. */
export interface FeedPost {
  id: string;
  content: string;
  media_url: string | null;
  likes_count: number;
  reposts_count: number;
  replies_count: number;
  created_at: string;
  profiles: Pick<Profile, "id" | "username" | "full_name" | "avatar_url"> | null;
}

/** Fetch feed posts with author profiles, newest first. */
export async function fetchFeedPosts(): Promise<FeedPost[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("posts")
    .select(
      "id, content, media_url, likes_count, reposts_count, replies_count, created_at, profiles:user_id (id, username, full_name, avatar_url)"
    )
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as FeedPost[];
}

/** Insert a post for the logged-in user (RLS enforces auth.uid() = user_id). */
export async function createPost(
  content: string,
  mediaUrl?: string
): Promise<FeedPost> {
  // P2 residual: mirror the API route's URL rules — the browser plane can
  // write posts directly through RLS, so validation must run here too.
  const media = validateOptionalUrl(mediaUrl);
  if (!media.ok) throw new Error(media.reason);
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in to post.");

  const { data, error } = await supabase
    .from("posts")
    .insert({
      user_id: user.id,
      content: content.trim(),
      media_url: media.url,
    })
    .select(
      "id, content, media_url, likes_count, reposts_count, replies_count, created_at, profiles:user_id (id, username, full_name, avatar_url)"
    )
    .single();
  if (error) throw new Error(error.message);
  return data as unknown as FeedPost;
}