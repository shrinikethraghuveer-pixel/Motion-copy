import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { bad, json, persist, readBody, requireUser } from "@/lib/server";
import { newId } from "@/lib/session";

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { me, db } = auth;
  const body = await readBody<{ targetType?: "user" | "post"; targetId?: string; reason?: string }>(req);

  if (!body.targetType || !body.targetId || !body.reason) return bad("Missing report details.");
  if (body.targetType === "user" && !db.users.some((u) => u.id === body.targetId)) return bad("User not found.", 404);
  if (body.targetType === "post" && !db.posts.some((p) => p.id === body.targetId)) return bad("Post not found.", 404);

  db.reports.push({
    id: newId("rep"),
    reporterId: me.id,
    targetType: body.targetType,
    targetId: body.targetId,
    reason: body.reason,
    createdAt: new Date().toISOString(),
  });
  await persist(db);
  // Silent handling: the reported party is never notified.
  return json({ ok: true });
}
