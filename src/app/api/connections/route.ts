import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { bad, json, persist, readBody, requireUser, shouldNotify, toPublicUser, withSettings } from "@/lib/server";
import { newId } from "@/lib/session";
import type { Notification } from "@/lib/schema";

export async function GET() {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { me, db } = auth;

  const friends = [];
  const incoming = [];
  const outgoing = [];
  for (const c of db.connections) {
    if (c.status === "accepted") {
      const otherId = c.requesterId === me.id ? c.targetId : c.requesterId;
      const other = db.users.find((u) => u.id === otherId);
      if (other) friends.push(toPublicUser(db, other, me.id));
    } else if (c.status === "pending") {
      const otherId = c.requesterId === me.id ? c.targetId : c.requesterId;
      const other = db.users.find((u) => u.id === otherId);
      if (!other) continue;
      if (c.targetId === me.id) incoming.push(toPublicUser(db, other, me.id));
      else outgoing.push(toPublicUser(db, other, me.id));
    }
  }
  return json({ friends, incoming, outgoing });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { me, db } = auth;
  const body = await readBody<{ targetId?: string; targetHandle?: string; action?: "connect" | "accept" | "remove" }>(req);

  const target = db.users.find((u) => u.id === body.targetId || u.handle === body.targetHandle);
  if (!target) return bad("User not found.", 404);
  if (target.id === me.id) return bad("That's you.");

  const link = () =>
    db.connections.find(
      (c) => (c.requesterId === me.id && c.targetId === target.id) || (c.requesterId === target.id && c.targetId === me.id)
    );

  const action = body.action ?? "connect";

  if (action === "connect") {
    const existing = link();
    if (existing) {
      if (existing.status === "accepted") return json({ state: "connected" });
      if (existing.requesterId === me.id) return json({ state: "pending_out" });
      existing.status = "accepted"; // they already asked — accept on tap, mutual instantly
      await persist(db);
      return json({ state: "connected" });
    }
    const targetSettings = withSettings(target);
    if (targetSettings.blocked.includes(me.id)) return bad("You can't connect with this user.", 403);
    if (targetSettings.allowConnectRequests === "no_one") return bad("This student isn't taking connection requests right now.", 403);
    db.connections.push({ requesterId: me.id, targetId: target.id, status: "pending", createdAt: new Date().toISOString() });
    if (shouldNotify(db, target.id, "connect")) {
      const n: Notification = { id: newId("n"), userId: target.id, type: "connect", actorId: me.id, postId: null, text: null, read: false, createdAt: new Date().toISOString() };
      db.notifications.unshift(n);
    }
    await persist(db);
    return json({ state: "pending_out" });
  }

  if (action === "accept") {
    const existing = link();
    if (!existing || existing.status !== "pending") return bad("No pending request.", 404);
    existing.status = "accepted";
    if (shouldNotify(db, existing.requesterId, "accept")) {
      const n: Notification = { id: newId("n"), userId: existing.requesterId, type: "accept", actorId: me.id, postId: null, text: null, read: false, createdAt: new Date().toISOString() };
      db.notifications.unshift(n);
    }
    await persist(db);
    return json({ state: "connected" });
  }

  if (action === "remove") {
    const i = db.connections.findIndex(link);
    if (i >= 0) db.connections.splice(i, 1);
    await persist(db);
    return json({ state: "none" });
  }

  return bad("Unknown action.");
}
