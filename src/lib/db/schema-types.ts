/**
 * Motion database schema types — mirror of `supabase/schema.sql`.
 * Keep in sync with the SQL file when columns change.
 */

export type Json = string | number | boolean | null | { [member: string]: Json } | Json[];

/** profiles — one row per auth user, auto-seeded by on_auth_user_created. */
export interface Profile {
  id: string;
  username: string;
  full_name: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  age: number | null;
  interests: string[];
  goal: string | null;
  feed_vibe: string | null;
  onboarding_completed: boolean;
  created_at: string;
  /** 0003 rich fields powering /profile/[username] + Edit Profile modal. */
  cover_url: string | null;
  headline: string | null;
  location: string | null;
  website_url: string | null;
  github_url: string | null;
  linkedin_url: string | null;
  tech_stack: string[];
}

export interface ProfileInsert {
  id: string;
  username: string;
  full_name?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  age?: number | null;
  interests?: string[];
  goal?: string | null;
  feed_vibe?: string | null;
  onboarding_completed?: boolean;
  cover_url?: string | null;
  headline?: string | null;
  location?: string | null;
  website_url?: string | null;
  github_url?: string | null;
  linkedin_url?: string | null;
  tech_stack?: string[];
}

export type ProfileUpdate = Partial<Omit<ProfileInsert, "id">>;

/** posts — public feed rows; the AI badge fields ride alongside content. */
export interface Post {
  id: string;
  user_id: string;
  content: string;
  media_url: string | null;
  is_ai_generated: boolean;
  ai_prompt: string | null;
  likes_count: number;
  reposts_count: number;
  replies_count: number;
  created_at: string;
}

export interface PostInsert {
  user_id: string;
  content: string;
  media_url?: string | null;
  is_ai_generated?: boolean;
  ai_prompt?: string | null;
}

export type PostUpdate = Partial<Omit<PostInsert, "user_id">>;

/** ai_generations — private Groq history; owner-only via RLS. */
export interface AiGeneration {
  id: string;
  user_id: string;
  prompt: string;
  response: string;
  model_used: string;
  created_at: string;
}

export interface AiGenerationInsert {
  user_id: string;
  prompt: string;
  response: string;
  model_used?: string;
}

export type AiGenerationUpdate = Partial<Omit<AiGenerationInsert, "user_id" | "prompt">>;

/** Shape accepted by supabase-js generic clients (supabase.from(table) typing). */
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: ProfileInsert;
        Update: ProfileUpdate;
      };
      posts: {
        Row: Post;
        Insert: PostInsert;
        Update: PostUpdate;
      };
      ai_generations: {
        Row: AiGeneration;
        Insert: AiGenerationInsert;
        Update: AiGenerationUpdate;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

/** Joined feed shape used by the UI (post + author profile). */
export type FeedPostRow = Post & {
  profiles: Pick<Profile, "id" | "username" | "full_name" | "display_name" | "avatar_url"> | null;
};

/** Full profile row fetched with the "*" column selector on /profile/[username]. */
export type ProfileRow = Profile;

/** A post + author + viewer flags, as returned by fetchProfilePosts. */
export interface ProfilePostRow {
  id: string;
  user_id: string;
  content: string;
  media_url: string | null;
  likes_count: number;
  reposts_count: number;
  replies_count: number;
  created_at: string;
  liked_by_me: boolean;
  profiles: Pick<Profile, "id" | "username" | "full_name" | "display_name" | "avatar_url"> | null;
}

/** Extended profile-post row with media + save flag (see lib/db/profiles.ts). */
export interface ProfilePagePostRow extends ProfilePostRow {
  saved_by_me: boolean;
  media: { seed: string; label: string } | null;
}

/** Aggregated stats powering the profile metrics bar. */
export interface ProfileStats {
  followers: number;
  following: number;
  projects: number;
  upvotes: number;
}

/** Shape followed/unfollow state. */
export interface FollowState {
  followers: number;
  following: number;
  isFollowing: boolean;
  isFollowedBy: boolean;
}

/** Everything /profile/[username] renders in one payload. */
export interface ProfilePageData {
  profile: ProfileRow;
  posts: ProfilePagePostRow[];
  liked: ProfilePagePostRow[];
  saved: ProfilePagePostRow[];
  stats: ProfileStats;
  follow: FollowState;
  isSelf: boolean;
  locked: boolean;
  source: "supabase" | "local";
  /** Legacy-store extras surfaced as profile metadata. */
  school: string | null;
  goal: string | null;
  interests: string[];
}
