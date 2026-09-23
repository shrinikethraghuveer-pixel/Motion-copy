import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { readDB, writeDB, serialize } from "@/lib/db";
import { clearSession, describeDevice, getSessionToken, getSessionUserId, newId, setSession } from "@/lib/session";
import { ageTagOf, type PublicUser, type User } from "@/lib/schema";
import { withSettings } from "@/lib/server";
import { DEMO_PASSWORD } from "@/lib/seed";
import { hashPassword, verifyPassword } from "@/lib/auth";

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
  // Dev convenience: APIs resolve a seeded user even with no session cookie.
  // Surface that so /welcome can tell "really signed in" from "dev fallback".
  const hasSessionCookie = Boolean(await getSessionToken());
  return NextResponse.json({
    user: me ? publicUser(me, selfId, db) : null,
    demoHandles: db.users.slice(0, 6).map((u) => ({ handle: u.handle, name: u.name })),
    devFallback: !hasSessionCookie && process.env.NODE_ENV === "development",
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    mode?: "signup" | "demo" | "login";
    handle?: string;
    password?: string;
    name?: string;
    email?: string;
    grade?: User["grade"];
    age?: number;
    skills?: string[];
    goals?: string[];
    discoverySource?: string;
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

  // Full signup — core auth only. The 4-step questionnaire (stage, interests,
  // goals, discovery source) happens post-auth in /onboarding.
  const rawHandle = (body.handle ?? "").trim();
  const handle = rawHandle.replace(/^@+/, "").toLowerCase();
  const name = typeof body.name === "string" && body.name.trim()
    ? body.name.trim().slice(0, 40)
    : handle
      ? handle.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
      : "";
  // Accepts 3–20 chars: letters, numbers, underscore, dot, dash (leading @ stripped).
  if (!/^[a-zA-Z0-9_.-]{3,20}$/.test(handle)) {
    return NextResponse.json(
      { error: "Handle must be 3–20 characters — letters, numbers, underscores, dots, or dashes." },
      { status: 400 }
    );
  }
  const age = Math.floor(Number(body.age));
  if (!Number.isInteger(age) || age < 12 || age > 105) {
    return NextResponse.json({ error: "Enter an age between 12 and 105." }, { status: 400 });
  }
  if (body.email && !/^\S+@\S+\.\S+$/.test(body.email.trim())) {
    return NextResponse.json({ error: "That email doesn't look valid." }, { status: 400 });
  }
  if (body.password && body.password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }
  if (db.users.some((u) => u.handle === handle)) {
    return NextResponse.json({ error: "That handle is taken — try another." }, { status: 409 });
  }

  const headlines: Record<User["grade"], string> = {
    middle: "New here — exploring what I love",
    high: "Student building in public",
    college: "Student building in public",
    grad: "Grad student in motion",
    self_taught: "Self-taught and building",
  };
  const skills = Array.isArray(body.skills)
    ? (body.skills as unknown[]).filter((s): s is string => typeof s === "string").map((s) => s.trim().replace(/^#/, "")).filter(Boolean).slice(0, 12)
    : [];
  const goals = Array.isArray(body.goals)
    ? (body.goals as unknown[]).filter((g): g is User["goal"] => typeof g === "string").slice(0, 5)
    : [];

  const user: User = {
    id: newId("u"),
    handle,
    name,
    grade: body.grade ?? "high",
    age,
    school: "Independent",
    headline: headlines[body.grade ?? "high"],
    skills,
    goal: goals[0] ?? "Find collaborators",
    goals: goals.length ? goals : ["Find collaborators"],
    discoverySource: typeof body.discoverySource === "string" ? body.discoverySource.slice(0, 60) : null,
    onboardedAt: null, // the post-auth questionnaire sets this
    following: [],
    createdAt: new Date().toISOString(),
  };
  if (body.email?.trim()) user.email = body.email.trim();
  if (body.password) user.passwordHash = hashPassword(body.password);
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
