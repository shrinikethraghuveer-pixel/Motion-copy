import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { bad, json, persist, readBody, requireUser, toPublicUser } from "@/lib/server";
import { newId } from "@/lib/session";
import type { Group } from "@/lib/schema";

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { me, db } = auth;
  const { searchParams } = new URL(req.url);
  const school = searchParams.get("school");

  let groups = db.groups;
  if (school) groups = groups.filter((g) => g.school === school);

  return json({
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      tag: g.tag,
      description: g.description,
      school: g.school,
      memberCount: g.members.length,
      myRole: g.members.find((m) => m.userId === me.id)?.role ?? null,
      members: g.members.slice(0, 8).map((m) => {
        const u = db.users.find((x) => x.id === m.userId);
        return u ? { ...toPublicUser(db, u, me.id), role: m.role } : null;
      }).filter(Boolean),
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { me, db } = auth;
  const body = await readBody<{ action?: "join" | "leave" | "create"; groupId?: string; name?: string; tag?: string; description?: string }>(req);
  const action = body.action ?? "join";

  if (action === "create") {
    const name = (body.name ?? "").trim();
    if (name.length < 3) return bad("Group name needs at least 3 characters.");
    const group: Group = {
      id: newId("g"),
      name,
      tag: body.tag?.trim() || "General",
      description: body.description?.trim() || "A fresh Motion group.",
      school: me.school === "Independent" ? null : me.school,
      createdAt: new Date().toISOString(),
      members: [{ userId: me.id, role: "admin", joinedAt: new Date().toISOString() }],
    };
    db.groups.push(group);
    await persist(db);
    return NextResponse.json({ ok: true, groupId: group.id }, { status: 201 });
  }

  const group = db.groups.find((g) => g.id === body.groupId);
  if (!group) return bad("Group not found.", 404);

  if (action === "join") {
    if (!group.members.some((m) => m.userId === me.id)) {
      group.members.push({ userId: me.id, role: "member", joinedAt: new Date().toISOString() });
      await persist(db);
    }
    return json({ ok: true, myRole: "member" });
  }

  if (action === "leave") {
    const adminCount = group.members.filter((m) => m.role === "admin").length;
    const mine = group.members.find((m) => m.userId === me.id);
    if (mine?.role === "admin" && adminCount === 1) return bad("Promote another admin before leaving.");
    group.members = group.members.filter((m) => m.userId !== me.id);
    await persist(db);
    return json({ ok: true, myRole: null });
  }

  return bad("Unknown action.");
}
