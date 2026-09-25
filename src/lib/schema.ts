export type Grade = "middle" | "high" | "college" | "grad" | "self_taught";
export type Goal = "Find collaborators" | "Discover internships" | "Meet peers" | "Showcase projects" | "Learn AI workflows";
export type AgeTag = "<18" | "18+";

/** Onboarding step 1 — academic / life stage options. */
export const GRADE_OPTIONS: Array<{ key: Grade; label: string; hint: string }> = [
  { key: "middle", label: "Middle School", hint: "Grades 6–8" },
  { key: "high", label: "High School", hint: "Grades 9–12" },
  { key: "college", label: "College / Undergrad", hint: "University" },
  { key: "grad", label: "Grad School", hint: "Masters / PhD" },
  { key: "self_taught", label: "Self-Taught / Professional", hint: "Learning on your own" },
];

/** Onboarding step 3 — multi-select goals. */
export const GOAL_OPTIONS_MULTI: Goal[] = [
  "Find collaborators",
  "Discover internships",
  "Meet peers",
  "Showcase projects",
  "Learn AI workflows",
];

/** Onboarding step 4 — discovery / analytics channel. */
export const DISCOVERY_SOURCES = [
  "X (Twitter)",
  "Instagram / TikTok",
  "YouTube / Podcast",
  "Friend or Colleague",
  "Search Engine / Google",
  "Community / Discord",
] as const;

/** User-friendly labels for the Grade union (profile pages, settings). */
export const GRADE_LABELS: Record<Grade, string> = Object.fromEntries(
  GRADE_OPTIONS.map((g) => [g.key, g.label])
) as Record<Grade, string>;

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

/* ---------- settings ---------- */

export type Audience = "everyone" | "connections" | "no_one";
export type ThemePref = "dark" | "light" | "system";
export type TextSize = "default" | "large" | "xlarge";
export type DisplayFont = "space" | "inter" | "system";

export interface NotificationPrefs {
  likes: boolean;
  comments: boolean;
  reposts: boolean;
  dms: boolean;
  connections: boolean;
  opportunities: boolean;
  announcements: boolean;
  emailDigest: boolean;
  smsAlerts: boolean;
}

export interface UserSettings {
  // Privacy & visibility
  privateProfile: boolean;
  showSchool: boolean;
  showAgeTag: boolean;
  allowMentions: Audience;
  allowDMs: Audience;
  allowConnectRequests: "everyone" | "no_one";
  allowReposts: boolean;
  discoverable: boolean;
  personalizeSuggestions: boolean;
  blurMedia: boolean;
  blocked: string[];
  muted: string[];
  // Notifications
  notify: NotificationPrefs;
  quietUntil: string | null;
  schoolHoursDND: boolean;
  // Security
  twoFactor: { enabled: boolean; method: "app" | "sms" | "passkey" };
  passkeys: string[];
  // Display & accessibility
  theme: ThemePref;
  textSize: TextSize;
  displayFont: DisplayFont;
  reducedMotion: boolean;
  highContrast: boolean;
  language: string;
  timezone: string;
  accentColor: string;
  lowSpecMode: boolean;
  aiPostSharpening: boolean;
  aiSmartRanking: boolean;
  aiDefaultModel: string;
  emailDigest: "off" | "daily" | "weekly";
}

export const DEFAULT_SETTINGS: UserSettings = {
  privateProfile: false,
  showSchool: true,
  showAgeTag: true,
  allowMentions: "everyone",
  allowDMs: "everyone",
  allowConnectRequests: "everyone",
  allowReposts: true,
  discoverable: true,
  personalizeSuggestions: true,
  blurMedia: false,
  blocked: [],
  muted: [],
  notify: {
    likes: true,
    comments: true,
    reposts: true,
    dms: true,
    connections: true,
    opportunities: true,
    announcements: true,
    emailDigest: false,
    smsAlerts: false,
  },
  quietUntil: null,
  schoolHoursDND: false,
  twoFactor: { enabled: false, method: "app" },
  passkeys: [],
  theme: "dark",
  textSize: "default",
  displayFont: "space",
  reducedMotion: false,
  highContrast: false,
  language: "en",
  timezone: "system",
  accentColor: "#7c3aed",
  lowSpecMode: false,
  aiPostSharpening: true,
  aiSmartRanking: true,
  aiDefaultModel: "openai/gpt-oss-20b",
  emailDigest: "weekly",
};

/** Which NotificationPrefs key each notification type maps to. */
export const NOTIFY_KEY_OF: Record<NotificationType, keyof NotificationPrefs> = {
  like: "likes",
  comment: "comments",
  repost: "reposts",
  connect: "connections",
  accept: "connections",
  event: "opportunities",
};

export interface User {
  id: string;
  handle: string;
  name: string;
  grade: Grade;
  /** Self-reported age in years, captured at onboarding — the source of truth for the age tag. */
  age?: number;
  school: string;
  headline: string;
  skills: string[];
  goal: Goal;
  /** All onboarding goals (multi-select); `goal` above stays the primary for legacy surfaces. */
  goals?: Goal[];
  /** Analytics: where this user heard about Motion. */
  discoverySource?: string | null;
  /** Set when the onboarding questionnaire is completed (or skipped). */
  onboardedAt?: string | null;
  following: string[];
  createdAt: string;
  settings?: UserSettings;
  photo?: string;
  banner?: string;
  bio?: string;
  email?: string;
  phone?: string;
  passwordHash?: string;
  deactivatedAt?: string | null;
}

/**
 * Derive the non-intrusive age tag from the user's real age when known.
 * A high-school senior can be 18 — grade alone is a legacy fallback.
 */
export const ageTagOf = (u: Pick<User, "grade"> & Partial<Pick<User, "age">>): AgeTag =>
  typeof u.age === "number" && u.age > 0 ? (u.age >= 18 ? "18+" : "<18") : u.grade === "college" ? "18+" : "<18";

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
  endTime?: string;
  durationMinutes?: number;
  capacity?: number | null;
  category?: string;
  attendeeIds?: string[];
  posterUrl?: string | null;
}

export interface PollOption {
  id: string;
  text: string;
  votes: string[];
}

export interface PollMeta {
  question: string;
  options: PollOption[];
  duration: string;
  multipleChoice: boolean;
  hideResults: boolean;
  totalVotes: number;
}

export interface PostMedia {
  kind: "art";
  seed: string;
  label: string;
}

export interface Post {
  id: string;
  authorId: string;
  type: "social" | "opportunity" | "poll";
  text: string;
  media: PostMedia | null;
  mediaUrls?: string[];
  poll?: PollMeta | null;
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

/** Group chat for the Messages view (legacy store mirror of group_chats/group_members). */
export interface DmGroup {
  id: string;
  name: string;
  description: string;
  avatarUrl: string | null;
  createdBy: string;
  members: Array<{ userId: string; role: "admin" | "member"; joinedAt: string }>;
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

export interface GroupJoinRequest {
  userId: string;
  requestedAt: string;
}

export interface GroupReply {
  id: string;
  authorId: string;
  text: string;
  createdAt: string;
}

export interface GroupDiscussionPost {
  id: string;
  authorId: string;
  text: string;
  createdAt: string;
  pinned: boolean;
  replies: GroupReply[];
}

export interface Group {
  id: string;
  name: string;
  tag: string;
  description: string;
  school: string | null;
  createdAt: string;
  members: GroupMember[];
  visibility?: "public" | "private";
  avatarUrl?: string | null;
  tags?: string[];
  joinRequests?: GroupJoinRequest[];
  posts?: GroupDiscussionPost[];
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

export interface SessionRecord {
  token: string;
  userId: string;
  device: string;
  createdAt: string;
  lastSeenAt: string;
}

export interface DB {
  users: User[];
  connections: Connection[];
  chats: Chat[];
  dmGroups: DmGroup[];
  posts: Post[];
  groups: Group[];
  notifications: Notification[];
  sessions: SessionRecord[];
  loginEvents: Array<{ userId: string; at: string; device: string }>;
  reports: Array<{ id: string; reporterId: string; targetType: "user" | "post" | "feedback"; targetId: string; reason: string; createdAt: string }>;
}

/* ---------- API payload shapes ---------- */

export interface PublicUser extends User {
  ageTag: AgeTag;
  isSelf: boolean;
  connectionState: "self" | "connected" | "pending_out" | "pending_in" | "none";
  settings: UserSettings;
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
