export type Grade = "middle" | "high" | "college";
export type Goal = "Find collaborators" | "Discover internships" | "Meet peers";
export type AgeTag = "<18" | "18+";

export const SKILL_OPTIONS = [
  "Coding",
  "Cricket",
  "UI/UX Design",
  "Video Editing",
  "Robotics",
  "AI",
  "Debate",
  "Photography",
  "Writing",
  "Music",
] as const;

export const GOAL_OPTIONS: Goal[] = ["Find collaborators", "Discover internships", "Meet peers"];

export const INTEREST_FILTERS = ["All", ...SKILL_OPTIONS] as const;

export const REPORT_REASONS = [
  "Spam or scam",
  "Harassment or bullying",
  "Impersonation",
  "Inappropriate content",
  "Something else",
] as const;

export interface User {
  id: string;
  handle: string;
  name: string;
  grade: Grade;
  school: string;
  headline: string;
  skills: string[];
  goal: Goal;
  following: string[];
  createdAt: string;
}

export const ageTagOf = (u: Pick<User, "grade">): AgeTag => (u.grade === "college" ? "18+" : "<18");

export type ConnectionStatus = "pending" | "accepted";

export interface Connection {
  requesterId: string;
  targetId: string;
  status: ConnectionStatus;
  createdAt: string;
}

export interface Comment {
  id: string;
  authorId: string;
  text: string;
  createdAt: string;
}

export type EventKind = "internship" | "hackathon" | "event";

export interface EventMeta {
  title: string;
  date: string;
  location: string;
  kind: EventKind;
}

export interface PostMedia {
  kind: "art";
  seed: string;
  label: string;
}

export interface Post {
  id: string;
  authorId: string;
  type: "social" | "opportunity";
  text: string;
  media: PostMedia | null;
  likes: string[];
  reposts: string[];
  comments: Comment[];
  savedBy: string[];
  event: EventMeta | null;
  createdAt: string;
}

export type ChatStatus = "active" | "pending" | "declined";

export interface ChatMessage {
  id: string;
  senderId: string;
  text: string;
  createdAt: string;
}

export interface Chat {
  id: string;
  participantIds: string[];
  status: ChatStatus;
  requestedBy: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export type GroupRole = "admin" | "moderator" | "member";

export interface GroupMember {
  userId: string;
  role: GroupRole;
  joinedAt: string;
}

export interface Group {
  id: string;
  name: string;
  tag: string;
  description: string;
  school: string | null;
  createdAt: string;
  members: GroupMember[];
}

export type NotificationType = "connect" | "accept" | "like" | "comment" | "repost" | "event";

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  actorId: string;
  postId: string | null;
  text: string | null;
  read: boolean;
  createdAt: string;
}

export interface DB {
  users: User[];
  connections: Connection[];
  chats: Chat[];
  posts: Post[];
  groups: Group[];
  notifications: Notification[];
  reports: Array<{ id: string; reporterId: string; targetType: "user" | "post"; targetId: string; reason: string; createdAt: string }>;
}

/* ---------- API payload shapes ---------- */

export interface PublicUser extends User {
  ageTag: AgeTag;
  isSelf: boolean;
  connectionState: "self" | "connected" | "pending_out" | "pending_in" | "none";
}

export interface FeedPost extends Post {
  author: PublicUser;
  likedByMe: boolean;
  repostedByMe: boolean;
  savedByMe: boolean;
}

export interface SuggestedUser {
  user: PublicUser;
  mutualCount: number;
  sharedSkills: string[];
  reason: string;
}

export interface ThreadSummary {
  id: string;
  status: ChatStatus;
  requestedByMe: boolean;
  incomingFrom: PublicUser | null;
  other: PublicUser;
  lastMessage: ChatMessage | null;
  unreadPreview: boolean;
  updatedAt: string;
}
