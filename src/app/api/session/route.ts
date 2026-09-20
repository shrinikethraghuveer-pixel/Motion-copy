import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { readDB, writeDB, serialize } from "@/lib/db";
import { clearSession, newId, setSession } from "@/lib/session";
import { ageTagOf, type PublicUser, type User } from "@/lib/schema";
import { DEMO_PASSWORD } from "@/lib/seed";

function publicUser(u: User, selfId: string | null, db: { connections: { requesterId: string; targetId: string; status: string }[] }): PublicUser {
  let connectionState: PublicUser["connectionState"] = "none";
  if (selfId && selfId !== u.id) {
    const link = db.connections.find(
      (c) =>
        (c.requesterId === selfId && c.targetId === u.id) ||
        (c.requesterId === u.id && c.targetId === selfId)
    );
    if (link) {
      if (link.status === "accepted") connectionState = "connected";
      else connectionState = link.requesterId === selfId ? "pending_out" : "pending_in";
    }
  }
  return { ...u, ageTag: ageTagOf(u), isSelf: selfId === u.id, connectionState };
}

export async function GET() {
  const db = await readDB();
  const { getSessionUserId } = await import("@/lib/session");
  const selfId = await getSessionUserId();
  const me = selfId ? db.users.find((u) => u.id === selfId) ?? null : null;
  return NextResponse.json({
    user: me ? publicUser(me, selfId, db) : null,
    demoHandles: db.users.slice(0, 6).map((u) => ({ handle: u.handle, name: u.name })),
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    mode?: "signup" | "demo";
    handle?: string;
    password?: string;
    grade?: User["grade"];
    skills?: string[];
    goal?: User["goal"];
  };
  const db = await readDB();

  // Demo quick-login (password "demo" for any seeded account)
  if (body.mode === "demo") {
    const user = db.users.find((u) => u.handle === body.handle);
    if (!user || body.password !== DEMO_PASSWORD) {
      return NextResponse.json({ error: "Unknown demo account or wrong password." }, { status: 401 });
    }
    await setSession(user.id);
    return NextResponse.json({ user: publicUser(user, user.id, db) });
  }

  // Full signup with 3-step onboarding payload
  const handle = (body.handle ?? "").trim().toLowerCase();
  const name = handle ? handle.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "";
  if (!/^[a-z0-9._-]{3,20}$/.test(handle)) {
    return NextResponse.json({ error: "Handle must be 3–20 chars: letters, numbers, dots, dashes." }, { status: 400 });
  }
  if (!body.grade) return NextResponse.json({ error: "Pick your academic stage." }, { status: 400 });
  if (!body.skills || body.skills.length < 3 || body.skills.length > 5) {
    return NextResponse.json({ error: "Pick 3 to 5 interests." }, { status: 400 });
  }
  if (!body.goal) return NextResponse.json({ error: "Pick your primary goal." }, { status: 400 });
  if (db.users.some((u) => u.handle === handle)) {
    return NextResponse.json({ error: "That handle is taken — try another." }, { status: 409 });
  }

  const headlines: Record<User["grade"], string> = {
    middle: "New here — exploring what I love",
    high: "Student building in public",
    college: "Student building in public",
  };

  const user: User = {
    id: newId("u"),
    handle,
    name,
    grade: body.grade,
    school: "Independent",
    headline: headlines[body.grade],
    skills: body.skills.slice(0, 5),
    goal: body.goal,
    following: [],
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  await serialize(() => writeDB(db));
  await setSession(user.id);
  return NextResponse.json({ user: publicUser(user, user.id, db) }, { status: 201 });
}

export async function DELETE() {
  await clearSession();
  return NextResponse.json({ ok: true });
}
