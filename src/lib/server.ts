import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { readDB, writeDB, serialize } from "@/lib/db";
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
  const selfId = await getSessionUserId();
  if (!selfId) return { res: bad("Not signed in.", 401) };
  const db = await readDB();
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

export function toPublicUser(db: DB, u: User, selfId: string | null): PublicUser {
  const s = withSettings(u);
  const { passwordHash: _ph, email: _e, phone: _p, ...safe } = u;
  return {
    ...safe,
    ageTag: ageTagOf(u), // display is gated client-side by settings.showAgeTag
    isSelf: selfId === u.id,
    connectionState: connectionStateBetween(db, selfId, u.id),
    settings: s,
  };
}

export function hydratePost(db: DB, post: Post, selfId: string | null): FeedPost {
  const author = db.users.find((u) => u.id === post.authorId);
  return {
    ...post,
    author: author
      ? toPublicUser(db, author, selfId)
      : {
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
          settings: DEFAULT_SETTINGS,
          deactivatedAt: new Date(0).toISOString(),
        },
    likedByMe: selfId ? post.likes.includes(selfId) : false,
    repostedByMe: selfId ? post.reposts.includes(selfId) : false,
    savedByMe: selfId ? post.savedBy.includes(selfId) : false,
  };
}

/** Persist after mutating `db`, serialized with all other writes. */
export async function persist(db: DB): Promise<void> {
  await serialize(() => writeDB(db));
}

export async function readBody<T>(req: NextRequest): Promise<T> {
  return (await req.json().catch(() => ({}))) as T;
}
