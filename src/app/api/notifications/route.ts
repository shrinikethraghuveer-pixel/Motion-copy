import { NextResponse } from "next/server";
import { json, persist, requireUser } from "@/lib/server";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import type { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { me, db } = auth;
  // Bounded result set (audit P8); `limit` is honored up to a hard cap.
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 200);
  const list = db.notifications
    .filter((n) => n.userId === me.id)
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .slice(0, limit);
  return json({ notifications: list, unread: list.filter((n) => !n.read).length });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { me, db } = auth;
  // Audit P4: mark-all-read rewrites the whole store; bound the write rate.
  const rate = await rateLimit(req, "notification-write", me.id, 6, 60);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfter);
  let changed = false;
  for (const n of db.notifications) {
    if (n.userId === me.id && !n.read) {
      n.read = true;
      changed = true;
    }
  }
  if (changed) await persist(db);
  return NextResponse.json({ ok: true });
}
