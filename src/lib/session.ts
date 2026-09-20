import { cookies } from "next/headers";
import { randomUUID } from "crypto";
import type { User } from "@/lib/schema";
import { readDB } from "@/lib/db";

const COOKIE = "motion_session";

export async function setSession(userId: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/** Current user id or null. Validates the cookie against the store. */
export async function getSessionUserId(): Promise<string | null> {
  const jar = await cookies();
  const id = jar.get(COOKIE)?.value;
  if (!id) return null;
  const db = await readDB();
  return db.users.some((u) => u.id === id) ? id : null;
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
