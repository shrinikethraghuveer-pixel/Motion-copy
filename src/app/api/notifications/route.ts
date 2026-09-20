import { NextResponse } from "next/server";
import { json, persist, requireUser } from "@/lib/server";
import type { NextRequest } from "next/server";

export async function GET() {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { me, db } = auth;
  const list = db.notifications
    .filter((n) => n.userId === me.id)
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  return json({ notifications: list, unread: list.filter((n) => !n.read).length });
}

export async function PATCH(_req: NextRequest) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { me, db } = auth;
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
