import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { DataStoreUnavailableError, readDB, writeDB, serialize } from "@/lib/db";
import {
  ageTagOf,
  DEFAULT_SETTINGS,
  NOTIFY_KEY_OF,
  type DB,
  type FeedPost,
  type Post,
  type PublicUser,
  type User,
  type UserSettings,
} from "@/lib/schema";

export const json = NextResponse.json;

/** Merge persisted settings over defaults so pre-settings accounts read cleanly. */
export function withSettings(u: Pick<User, "settings">): UserSettings {
  const s: Partial<UserSettings> = u.settings ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    notify: { ...DEFAULT_SETTINGS.notify, ...(s.notify ?? {}) },
    twoFactor: { ...DEFAULT_SETTINGS.twoFactor, ...(s.twoFactor ?? {}) },
    blocked: s.blocked ?? [],
    muted: s.muted ?? [],
    passkeys: s.passkeys ?? [],
  };
}

/** True when the recipient's notification prefs allow this notification type. */
export function shouldNotify(db: DB, recipientId: string, type: keyof typeof NOTIFY_KEY_OF): boolean {
  const u = db.users.find((x) => x.id === recipientId);
  if (!u || u.deactivatedAt) return false;
  return withSettings(u).notify[NOTIFY_KEY_OF[type]];
}

export function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

export async function requireUser(): Promise<{ me: User; db: DB } | { res: NextResponse }> {
  let selfId: string | null;
  let db: DB;
  try {
    // Session validation itself consults the store (session touch/lastSeen),
    // so both calls share the fail-closed catch (audit P0-1).
    selfId = await getSessionUserId();
    db = await readDB();
  } catch (error) {
    // Audit P0-1: a missing/corrupt local store fails closed with a clear
    // operational error instead of a stack-trace 500 or silent re-seed.
    if (error instanceof DataStoreUnavailableError) {
      return { res: bad("Local data store unavailable. Run `npm run seed:db` to initialize it.", 503) };
    }
    throw error;
  }
  if (!selfId) return { res: bad("Not signed in.", 401) };
  const me = db.users.find((u) => u.id === selfId);
  if (!me) return { res: bad("Session invalid — sign in again.", 401) };
  return { me, db };
}

export function connectionStateBetween(db: DB, selfId: string | null, otherId: string): PublicUser["connectionState"] {
  if (!selfId || selfId === otherId) return "self";
  const link = db.connections.find(
    (c) => (c.requesterId === selfId && c.targetId === otherId) || (c.requesterId === otherId && c.targetId === selfId)
  );
  if (!link) return "none";
  if (link.status === "accepted") return "connected";
  return link.requesterId === selfId ? "pending_out" : "pending_in";
}

/**
 * Viewer-safe settings (audit N1): another user's settings respond with
 * DISPLAY-SAFE defaults so the shape stays UserSettings-compatible. The real
 * block/mute lists, messaging policy, notification prefs and passkey
 * descriptors never leave the server for another user's profile. Only the
 * showAgeTag/showSchool display flags — which a viewer is meant to honor —
 * are copied from the real settings.
 */
export function publicSettings(v: User, selfId: string | null): UserSettings {
  const s = withSettings(v);
  if (selfId === v.id) return s;
  const safeDefaults: UserSettings = {
    ...DEFAULT_SETTINGS,
    notify: { ...DEFAULT_SETTINGS.notify },
    twoFactor: { ...DEFAULT_SETTINGS.twoFactor },
    blocked: [],
    muted: [],
    passkeys: [],
  };
  safeDefaults.showAgeTag = s.showAgeTag;
  safeDefaults.showSchool = s.showSchool;
  return safeDefaults;
}

export function toPublicUser(db: DB, u: User, selfId: string | null): PublicUser {
  const { passwordHash: _ph, email: _e, phone: _p, ...safe } = u;
  return {
    ...safe,
    ageTag: ageTagOf(u), // display is gated by the exposed showAgeTag flag
    isSelf: selfId === u.id,
    connectionState: connectionStateBetween(db, selfId, u.id),
    settings: publicSettings(u, selfId),
  };
}

/**
 * Reduce raw interaction lists to viewer-safe values (audit P7): counts,
 * the viewer's own selections and identity-free totals. Server-side code keeps
 * the full Post type; only API responses are redacted here. Callers attach
 * the author separately so this helper never leaks identity data it does not
 * control.
 */
export function redactPostForViewer(
  post: Post,
  selfId: string | null
): Omit<import("@/lib/schema").FeedPost, "author"> {
  const poll = post.poll
    ? {
        question: post.poll.question,
        duration: post.poll.duration,
        multipleChoice: post.poll.multipleChoice,
        hideResults: post.poll.hideResults,
        totalVotes: post.poll.totalVotes,
        hasVoted: selfId
          ? post.poll.options.some((option) => option.votes.includes(selfId))
          : false,
        options: post.poll.options.map((option) => ({
          id: option.id,
          text: option.text,
          voteCount: option.votes.length,
          myVote: selfId ? option.votes.includes(selfId) : false,
        })),
      }
    : null;
  return {
    id: post.id,
    authorId: post.authorId,
    type: post.type,
    text: post.text,
    media: post.media ?? null,
    mediaUrls: post.mediaUrls,
    poll: poll as import("@/lib/schema").HydratedPollMeta | null,
    comments: post.comments,
    event: post.event
      ? {
          title: post.event.title,
          date: post.event.date,
          location: post.event.location,
          kind: post.event.kind,
          endTime: post.event.endTime,
          durationMinutes: post.event.durationMinutes,
          capacity: post.event.capacity,
          category: post.event.category,
          posterUrl: post.event.posterUrl,
          link: post.event.link,
          attendeeCount: post.event.attendeeIds?.length ?? 0,
          rsvpdByMe: selfId
            ? (post.event.attendeeIds ?? []).includes(selfId)
            : false,
        }
      : null,
    createdAt: post.createdAt,
    likesCount: post.likes.length,
    repostsCount: post.reposts.length,
    likedByMe: selfId ? post.likes.includes(selfId) : false,
    repostedByMe: selfId ? post.reposts.includes(selfId) : false,
    savedByMe: selfId ? post.savedBy.includes(selfId) : false,
  };
}

export function hydratePost(db: DB, post: Post, selfId: string | null): FeedPost {
  const author = db.users.find((u) => u.id === post.authorId);
  return {
    ...redactPostForViewer(post, selfId),
    author: author ? toPublicUser(db, author, selfId) : ghostAuthor(post),
  };
}

function ghostAuthor(post: Post) {
  return {
    id: post.authorId,
    handle: "ghost",
    name: "Deleted User",
    grade: "high",
    school: "—",
    headline: "",
    skills: [],
    goal: "Meet peers",
    following: [],
    createdAt: post.createdAt,
    ageTag: "18+",
    isSelf: false,
    connectionState: "none",
    settings: {},
    deactivatedAt: new Date(0).toISOString(),
  } as unknown as PublicUser;
}

/** Persist after mutating `db`, serialized with all other writes. */
export async function persist(db: DB): Promise<void> {
  await serialize(() => writeDB(db));
}

export async function readBody<T>(req: NextRequest): Promise<T> {
  return (await req.json().catch(() => ({}))) as T;
}
