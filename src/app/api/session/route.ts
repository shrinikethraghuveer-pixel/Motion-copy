import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { readDB, writeDB, serialize } from "@/lib/db";
import { clearSession, describeDevice, getSessionUserId, newId, setSession } from "@/lib/session";
import { ageTagOf, type PublicUser, type User } from "@/lib/schema";
import { withSettings } from "@/lib/server";
import { DEMO_PASSWORD } from "@/lib/seed";
import { verifyPassword } from "@/lib/auth";

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
  const { passwordHash: _ph, email: _e, phone: _p, ...safe } = u;
  return { ...safe, ageTag: ageTagOf(u), isSelf: selfId === u.id, connectionState, settings: withSettings(u) };
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
    mode?: "signup" | "demo" | "login";
    handle?: string;
    password?: string;
    grade?: User["grade"];
    age?: number;
    skills?: string[];
    goal?: User["goal"];
  };
  const db = await readDB();
  const ua = (await headers()).get("user-agent") ?? "";
  const logLogin = async (userId: string) => {
    db.loginEvents.unshift({ userId, at: new Date().toISOString(), device: describeDevice(ua) });
    db.loginEvents = db.loginEvents.slice(0, 200);
  };

  // Demo quick-login (password "demo" for any seeded account)
  if (body.mode === "demo") {
    const user = db.users.find((u) => u.handle === body.handle);
    if (!user || body.password !== DEMO_PASSWORD) {
      return NextResponse.json({ error: "Unknown demo account or wrong password." }, { status: 401 });
    }
    if (user.deactivatedAt) {
      return NextResponse.json({ error: "This account is deactivated. Reactivate from Settings to sign back in." }, { status: 403 });
    }
    await logLogin(user.id);
    await serialize(() => writeDB(db));
    await setSession(user.id);
    return NextResponse.json({ user: publicUser(user, user.id, db) });
  }

  // Real password login (password set via Settings → Security)
  if (body.mode === "login") {
    const user = db.users.find((u) => u.handle === body.handle);
    if (!user?.passwordHash || !verifyPassword(body.password ?? "", user.passwordHash)) {
      return NextResponse.json({ error: "Wrong handle or password." }, { status: 401 });
    }
    if (user.deactivatedAt) {
      return NextResponse.json({ error: "This account is deactivated. Reactivate from Settings to sign back in." }, { status: 403 });
    }
    await logLogin(user.id);
    await serialize(() => writeDB(db));
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
  const age = Math.floor(Number(body.age));
  if (!Number.isFinite(age) || age < 10 || age > 30) {
    return NextResponse.json({ error: "Enter a real age between 10 and 30." }, { status: 400 });
  }
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
    age,
    school: "Independent",
    headline: headlines[body.grade],
    skills: body.skills.slice(0, 5),
    goal: body.goal,
    following: [],
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  await logLogin(user.id);
  await serialize(() => writeDB(db));
  await setSession(user.id);
  return NextResponse.json({ user: publicUser(user, user.id, db) }, { status: 201 });
}

export async function DELETE() {
  await clearSession();
  return NextResponse.json({ ok: true });
}
