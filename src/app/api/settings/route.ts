import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { bad, json, persist, readBody, requireUser, withSettings } from "@/lib/server";
import { clearSession, getSessionToken, newId } from "@/lib/session";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { DEFAULT_SETTINGS, type Audience, type DB, type ThemePref, type TextSize, type DisplayFont } from "@/lib/schema";

/* ---------- helpers ---------- */

function mySettings(db: DB, meId: string) {
  const me = db.users.find((u) => u.id === meId)!;
  return { me, s: withSettings(me) };
}

function publicProfileOf(u: DB["users"][number]) {
  return {
    id: u.id,
    handle: u.handle,
    name: u.name,
    headline: u.headline,
    school: u.school,
    photo: u.photo ?? null,
    email: u.email ?? null,
    phone: u.phone ?? null,
    createdAt: u.createdAt,
  };
}

/* ---------- GET /api/settings — everything the page needs in one call ---------- */

export async function GET() {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { me, db } = auth;
  const s = withSettings(me);

  const sessions = db.sessions
    .filter((x) => x.userId === me.id)
    .sort((a, b) => +new Date(b.lastSeenAt) - +new Date(a.lastSeenAt))
    .map((x) => ({ token: x.token, device: x.device, createdAt: x.createdAt, lastSeenAt: x.lastSeenAt }));

  const loginEvents = db.loginEvents
    .filter((x) => x.userId === me.id)
    .sort((a, b) => +new Date(b.at) - +new Date(a.at))
    .slice(0, 10)
    .map((x) => ({ at: x.at, device: x.device }));

  const pub = (id: string) => {
    const u = db.users.find((x) => x.id === id);
    return u ? { handle: u.handle, name: u.name, id: u.id } : null;
  };

  return json({
    profile: publicProfileOf(me),
    settings: s,
    blocked: s.blocked.map(pub).filter(Boolean),
    muted: s.muted.map(pub).filter(Boolean),
    sessions,
    loginEvents,
    activeSessionToken: await getSessionToken(),
    plan: { tier: "free", price: 0, renewsAt: null, imageLimit: 1, textLimit: 500 },
    version: "1.0.0",
  });
}

/* ---------- PATCH /api/settings — one endpoint, sectioned payloads ---------- */

export async function PATCH(req: NextRequest) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { me, db } = auth;
  const body = await readBody<Record<string, unknown>>(req);
  const { s } = mySettings(db, me.id);

  // --- Account & profile ---
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (name.length < 2 || name.length > 40) return bad("Name must be 2–40 characters.");
    me.name = name;
  }
  if (typeof body.headline === "string") me.headline = body.headline.trim().slice(0, 80);
  if (typeof body.email === "string") {
    const email = body.email.trim();
    if (email && !/^\S+@\S+\.\S+$/.test(email)) return bad("That email doesn't look valid.");
    me.email = email || undefined;
  }
  if (typeof body.phone === "string") me.phone = body.phone.trim() || undefined;
  if (typeof body.photo === "string") {
    if (body.photo.length > 300_000) return bad("Photo is too large — pick something under ~200KB.", 413);
    me.photo = body.photo || undefined;
  }

  // --- Privacy ---
  if (typeof body.privateProfile === "boolean") s.privateProfile = body.privateProfile;
  if (typeof body.showSchool === "boolean") s.showSchool = body.showSchool;
  if (typeof body.showAgeTag === "boolean") s.showAgeTag = body.showAgeTag;
  if (typeof body.allowMentions === "string") {
    if (!["everyone", "connections", "no_one"].includes(body.allowMentions)) return bad("Invalid mention policy.");
    s.allowMentions = body.allowMentions as Audience;
  }
  if (typeof body.allowDMs === "string") {
    if (!["everyone", "connections", "no_one"].includes(body.allowDMs)) return bad("Invalid DM policy.");
    s.allowDMs = body.allowDMs as Audience;
  }
  if (typeof body.allowConnectRequests === "string") {
    if (!["everyone", "no_one"].includes(body.allowConnectRequests)) return bad("Invalid connect policy.");
    s.allowConnectRequests = body.allowConnectRequests as "everyone" | "no_one";
  }
  if (typeof body.allowReposts === "boolean") s.allowReposts = body.allowReposts;
  if (typeof body.discoverable === "boolean") s.discoverable = body.discoverable;
  if (typeof body.personalizeSuggestions === "boolean") s.personalizeSuggestions = body.personalizeSuggestions;
  if (typeof body.blurMedia === "boolean") s.blurMedia = body.blurMedia;

  // --- Notifications ---
  if (body.notify && typeof body.notify === "object") {
    const n = body.notify as Record<string, unknown>;
    for (const k of Object.keys(DEFAULT_SETTINGS.notify) as Array<keyof typeof DEFAULT_SETTINGS.notify>) {
      if (typeof n[k] === "boolean") s.notify[k] = n[k] as boolean;
    }
  }
  if ("quietUntil" in body) s.quietUntil = typeof body.quietUntil === "string" ? body.quietUntil : null;
  if (typeof body.schoolHoursDND === "boolean") s.schoolHoursDND = body.schoolHoursDND;

  // --- Security: password ---
  if (typeof body.newPassword === "string") {
    if (me.passwordHash && !verifyPassword(String(body.currentPassword ?? ""), me.passwordHash)) {
      return bad("Current password is incorrect.", 403);
    }
    const pw = body.newPassword;
    if (pw.length < 8) return bad("Password must be at least 8 characters.");
    me.passwordHash = hashPassword(pw);
  }

  // --- Security: 2FA & passkeys ---
  if (typeof body.twoFactorEnabled === "boolean") {
    s.twoFactor.enabled = body.twoFactorEnabled;
    if (!body.twoFactorEnabled) s.twoFactor.method = "app";
  }
  if (typeof body.twoFactorMethod === "string") {
    if (!["app", "sms", "passkey"].includes(body.twoFactorMethod)) return bad("Unknown 2FA method.");
    s.twoFactor.method = body.twoFactorMethod as "app" | "sms" | "passkey";
    s.twoFactor.enabled = true;
  }
  if (body.addPasskey === true) {
    const name = `Passkey ${s.passkeys.length + 1}`;
    s.passkeys.push(name);
    s.twoFactor.method = "passkey";
    s.twoFactor.enabled = true;
  }
  if (typeof body.removePasskey === "string") s.passkeys = s.passkeys.filter((p) => p !== body.removePasskey);

  // --- Display & accessibility ---
  if (typeof body.theme === "string") {
    if (!["dark", "light", "system"].includes(body.theme)) return bad("Unknown theme.");
    s.theme = body.theme as ThemePref;
  }
  if (typeof body.textSize === "string") {
    if (!["default", "large", "xlarge"].includes(body.textSize)) return bad("Unknown text size.");
    s.textSize = body.textSize as TextSize;
  }
  if (typeof body.displayFont === "string") {
    if (!["space", "inter", "system"].includes(body.displayFont)) return bad("Unknown font.");
    s.displayFont = body.displayFont as DisplayFont;
  }
  if (typeof body.reducedMotion === "boolean") s.reducedMotion = body.reducedMotion;
  if (typeof body.highContrast === "boolean") s.highContrast = body.highContrast;
  if (typeof body.language === "string") s.language = body.language;
  if (typeof body.timezone === "string") s.timezone = body.timezone;

  me.settings = s;
  await persist(db);
  return json({ ok: true, settings: s, profile: publicProfileOf(me) });
}

/* ---------- POST /api/settings — actions ---------- */

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { me, db } = auth;
  const body = await readBody<{
    action?: string;
    handle?: string;
    token?: string;
    hours?: number;
    text?: string;
    reason?: string;
  }>(req);

  switch (body.action) {
    case "block": {
      const t = db.users.find((u) => u.handle === body.handle);
      if (!t) return bad("User not found.", 404);
      if (t.id === me.id) return bad("You can't block yourself.");
      const s = withSettings(me);
      if (!s.blocked.includes(t.id)) {
        s.blocked.push(t.id);
        s.muted = s.muted.filter((id) => id !== t.id);
        // Block dissolves the relationship in both directions.
        db.connections = db.connections.filter(
          (c) => !((c.requesterId === me.id && c.targetId === t.id) || (c.requesterId === t.id && c.targetId === me.id))
        );
        db.chats = db.chats.filter(
          (c) => !(c.participantIds.length === 2 && c.participantIds.includes(me.id) && c.participantIds.includes(t.id))
        );
        me.settings = s;
        await persist(db);
      }
      return json({ ok: true, blocked: s.blocked });
    }
    case "unblock": {
      const s = withSettings(me);
      s.blocked = s.blocked.filter((id) => id !== body.handle && db.users.find((u) => u.handle === body.handle)?.id !== id);
      s.blocked = s.blocked.filter((id) => id !== db.users.find((u) => u.handle === body.handle)?.id);
      me.settings = s;
      await persist(db);
      return json({ ok: true, blocked: s.blocked });
    }
    case "mute": {
      const t = db.users.find((u) => u.handle === body.handle);
      if (!t) return bad("User not found.", 404);
      const s = withSettings(me);
      if (!s.muted.includes(t.id)) s.muted.push(t.id);
      me.settings = s;
      await persist(db);
      return json({ ok: true, muted: s.muted });
    }
    case "unmute": {
      const s = withSettings(me);
      const id = db.users.find((u) => u.handle === body.handle)?.id;
      s.muted = s.muted.filter((x) => x !== id);
      me.settings = s;
      await persist(db);
      return json({ ok: true, muted: s.muted });
    }
    case "revoke-session": {
      if (body.token === (await getSessionToken())) return bad("You can't revoke the session you're using right now.");
      const before = db.sessions.length;
      db.sessions = db.sessions.filter((x) => !(x.userId === me.id && x.token === body.token));
      if (db.sessions.length === before) return bad("Session not found.", 404);
      await persist(db);
      return json({ ok: true });
    }
    case "revoke-others": {
      const cur = await getSessionToken();
      db.sessions = db.sessions.filter((x) => x.userId !== me.id || x.token === cur);
      await persist(db);
      return json({ ok: true });
    }
    case "quiet": {
      const hours = Math.min(24 * 7, Math.max(1, Number(body.hours) || 8));
      const s = withSettings(me);
      s.quietUntil = new Date(Date.now() + hours * 3600_000).toISOString();
      me.settings = s;
      await persist(db);
      return json({ ok: true, quietUntil: s.quietUntil });
    }
    case "quiet-off": {
      const s = withSettings(me);
      s.quietUntil = null;
      me.settings = s;
      await persist(db);
      return json({ ok: true });
    }
    case "export": {
      const s = withSettings(me);
      const archive = {
        exportedAt: new Date().toISOString(),
        profile: publicProfileOf(me),
        settings: s,
        posts: db.posts.filter((p) => p.authorId === me.id),
        likes: db.posts.filter((p) => p.likes.includes(me.id)).map((p) => p.id),
        connections: db.connections.filter((c) => c.requesterId === me.id || c.targetId === me.id),
        chats: db.chats
          .filter((c) => c.participantIds.includes(me.id))
          .map((c) => ({ id: c.id, status: c.status, messages: c.messages })),
        groups: db.groups.filter((g) => g.members.some((m) => m.userId === me.id)),
        notifications: db.notifications.filter((n) => n.userId === me.id),
      };
      return new NextResponse(JSON.stringify(archive, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="motion-archive-${me.handle}.json"`,
        },
      });
    }
    case "deactivate": {
      me.deactivatedAt = new Date().toISOString();
      await persist(db);
      await clearSession();
      return json({ ok: true });
    }
    case "delete": {
      if (body.text?.trim().toUpperCase() !== "DELETE") return bad('Type DELETE to confirm.');
      const id = me.id;
      db.users = db.users.filter((u) => u.id !== id);
      db.connections = db.connections.filter((c) => c.requesterId !== id && c.targetId !== id);
      db.posts = db.posts.filter((p) => p.authorId !== id);
      db.chats = db.chats.filter((c) => !c.participantIds.includes(id));
      db.notifications = db.notifications.filter((n) => n.userId !== id);
      db.sessions = db.sessions.filter((x) => x.userId !== id);
      db.groups.forEach((g) => (g.members = g.members.filter((m) => m.userId !== id)));
      await persist(db);
      await clearSession();
      return json({ ok: true });
    }
    case "feedback": {
      const text = (body.text ?? "").trim();
      if (!text) return bad("Tell us what's on your mind.");
      db.reports.unshift({ id: newId("r"), reporterId: me.id, targetType: "feedback", targetId: "-", reason: text.slice(0, 500), createdAt: new Date().toISOString() });
      await persist(db);
      return json({ ok: true });
    }
  }
  return bad("Unknown action.");
}
