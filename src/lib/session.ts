import { cookies, headers } from "next/headers";
import { randomUUID } from "crypto";
import type { User } from "@/lib/schema";
import { readDB, writeDB, serialize } from "@/lib/db";

const COOKIE = "motion_session";
const DEVELOPMENT_USER_ID = "u_maya";

/** Human label for the User-Agent — powers the Active Sessions list. */
export function describeDevice(ua: string): string {
  if (/iphone|ipad/i.test(ua)) return "iPhone";
  if (/android/i.test(ua)) return "Android device";
  if (/windows/i.test(ua)) return "Windows · Browser";
  if (/mac/i.test(ua)) return "Mac · Browser";
  if (/linux/i.test(ua)) return "Linux · Browser";
  return "Unknown device";
}

/** Create a session record + set the cookie (token-based, revocable). */
export async function setSession(userId: string): Promise<void> {
  const jar = await cookies();
  const h = await headers();
  const token = `s_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const now = new Date().toISOString();
  const device = describeDevice(h.get("user-agent") ?? "");
  await serialize(async () => {
    const db = await readDB();
    db.sessions.push({ token, userId, device, createdAt: now, lastSeenAt: now });
    await writeDB(db);
  });
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function getSessionToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(COOKIE)?.value ?? null;
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token?.startsWith("s_")) {
    await serialize(async () => {
      const db = await readDB();
      db.sessions = db.sessions.filter((s) => s.token !== token);
      await writeDB(db);
    });
  }
  jar.delete(COOKIE);
}

/** Current user id or null. Validates the cookie against the store (legacy plain-userId cookies still work). */
export async function getSessionUserId(): Promise<string | null> {
  const jar = await cookies();
  const v = jar.get(COOKIE)?.value;
  // Keep local route previews usable without requiring a login. This is never
  // enabled in a production build, and uses a seeded user that APIs can resolve.
  if (!v) return process.env.NODE_ENV === "development" ? DEVELOPMENT_USER_ID : null;
  const db = await readDB();
  let userId: string | null = null;
  if (v.startsWith("s_")) {
    const s = db.sessions.find((x) => x.token === v);
    if (!s) return null;
    userId = s.userId;
  } else {
    userId = v; // legacy cookie from before sessions existed
  }
  const user = db.users.find((u) => u.id === userId);
  return user && !user.deactivatedAt ? userId : null;
}

/** Fresh copy of the signed-in user, or null. */
export async function getCurrentUser(): Promise<User | null> {
  const id = await getSessionUserId();
  if (!id) return null;
  const db = await readDB();
  return db.users.find((u) => u.id === id) ?? null;
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 12)}`;
}
