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
  /** Current banner field; kept in sync with cover_url for older consumers. */
  banner_url: string | null;
  headline: string | null;
  location: string | null;
  website_url: string | null;
  github_url: string | null;
  linkedin_url: string | null;
  tech_stack: string[];
  /** Display cache for the selected canonical institution or unlisted name. */
  school?: string | null;
  institution_id?: string | null;
  institution_not_listed?: boolean;
  institution_custom_name?: string | null;
  currently_in_educational_institution?: boolean | null;
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
  banner_url?: string | null;
  headline?: string | null;
  location?: string | null;
  website_url?: string | null;
  github_url?: string | null;
  linkedin_url?: string | null;
  tech_stack?: string[];
  school?: string | null;
  institution_id?: string | null;
  institution_not_listed?: boolean;
  institution_custom_name?: string | null;
  currently_in_educational_institution?: boolean | null;
}

export type ProfileUpdate = Partial<Omit<ProfileInsert, "id">>;

export interface UserReport {
  id: string;
  reporter_id: string;
  target_type: "user" | "post";
  target_id: string;
  reason: string;
  status: "pending" | "dismissed" | "actioned";
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

export type UserReportInsert = Pick<UserReport, "reporter_id" | "target_type" | "target_id" | "reason"> & Partial<Pick<UserReport, "status" | "reviewed_at" | "reviewed_by">>;
export type UserReportUpdate = Partial<Omit<UserReport, "id" | "reporter_id" | "target_type" | "target_id">>;

/** posts — public feed rows; the AI badge fields ride alongside content. */
export interface Post {
  id: string;
  user_id: string;
  content: string;
  media_url: string | null;
  post_type: "text" | "event" | "poll";
  event_details: PostEventDetails | null;
  poll_details: PostPollDetails | null;
  media_urls: string[];
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
  post_type?: "text" | "event" | "poll";
  event_details?: PostEventDetails | null;
  poll_details?: PostPollDetails | null;
  media_urls?: string[];
  is_ai_generated?: boolean;
  ai_prompt?: string | null;
}

export type PostUpdate = Partial<Omit<PostInsert, "user_id">>;

export interface PostEventDetails {
  title: string;
  venue: string;
  date_time: string;
  duration: string | number | null;
  poster_url: string | null;
  max_capacity: number | null;
  category: string;
  attendee_ids: string[];
}

export interface PostPollOption {
  id: string;
  text: string;
  votes: string[];
}

export interface PostPollDetails {
  question: string;
  options: PostPollOption[];
  duration: string;
  multiple_choice: boolean;
  hide_results: boolean;
  total_votes: number;
}

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

/** group_chats — group conversations alongside 1-on-1 DMs. */
export interface GroupChat {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  created_by: string;
  created_at: string;
}

export interface GroupChatInsert extends Partial<Pick<GroupChat, "id" | "created_at">> {
  name: string;
  description?: string | null;
  avatar_url?: string | null;
  created_by: string;
}

export type GroupChatUpdate = Partial<Omit<GroupChatInsert, "id" | "created_by">>;

/** group_members — roster row; role is 'admin' | 'member'. */
export interface GroupMember {
  group_id: string;
  user_id: string;
  role: "admin" | "member";
  joined_at: string;
}

export interface GroupMemberInsert extends Partial<Pick<GroupMember, "role" | "joined_at">> {
  group_id: string;
  user_id: string;
}

/** messages — one DM or group message; receiver_id is null for group rows. */
export interface Message {
  id: string;
  sender_id: string;
  receiver_id: string | null;
  group_id: string | null;
  content: string;
  read: boolean;
  created_at: string;
}

export interface MessageInsert {
  sender_id: string;
  receiver_id?: string | null;
  group_id?: string | null;
  content: string;
  read?: boolean;
}

/** Shape accepted by supabase-js generic clients (supabase.from(table) typing). */
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: ProfileInsert;
        Update: ProfileUpdate;
      };
      user_reports: {
        Row: UserReport;
        Insert: UserReportInsert;
        Update: UserReportUpdate;
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
      messages: {
        Row: Message;
        Insert: MessageInsert;
        Update: Partial<Omit<MessageInsert, "sender_id">>;
      };
      group_chats: {
        Row: GroupChat;
        Insert: GroupChatInsert;
        Update: GroupChatUpdate;
      };
      group_members: {
        Row: GroupMember;
        Insert: GroupMemberInsert;
        Update: Partial<Omit<GroupMemberInsert, "group_id" | "user_id">>;
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
