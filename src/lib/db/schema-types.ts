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
