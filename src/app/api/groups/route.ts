import { NextResponse, type NextRequest } from "next/server";
import { bad, json, persist, readBody, requireUser, toPublicUser } from "@/lib/server";
import { newId } from "@/lib/session";
import type { Group } from "@/lib/schema";
import { validateOptionalUrl } from "@/lib/url-validation";
import { screenUserText } from "@/lib/moderation";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { me, db } = auth;
  const school = new URL(req.url).searchParams.get("school");
  // Bounded result set (audit P8); `limit` is honored up to a hard cap.
  const limit = Math.min(Math.max(Number(new URL(req.url).searchParams.get("limit")) || 60, 1), 120);
  const groups = (school ? db.groups.filter((g) => g.school === school) : db.groups).slice(0, limit);
  return json({ groups: groups.map((g) => {
    const membership = g.members.find((m) => m.userId === me.id);
    const request = g.joinRequests?.find((r) => r.userId === me.id);
    return {
      id: g.id, name: g.name, tag: g.tag, description: g.description, school: g.school,
      memberCount: g.members.length, myRole: membership?.role ?? null,
      visibility: g.visibility ?? "public", avatarUrl: g.avatarUrl ?? null,
      tags: g.tags ?? [g.tag], myRequestStatus: membership ? "member" : request ? "pending" : "none",
      members: ((g.visibility ?? "public") === "private" && !membership ? [] : g.members.slice(0, 8)).map((m) => {
        const u = db.users.find((x) => x.id === m.userId);
        return u ? { ...toPublicUser(db, u, me.id), role: m.role } : null;
      }).filter(Boolean),
    };
  }) });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { me, db } = auth;
  // Audit P4: community create/join/leave writes were previously unthrottled.
  const rate = await rateLimit(req, "community-write", me.id, 10, 60);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfter);
  const body = await readBody<{ action?: string; groupId?: string; name?: string; tag?: string; tags?: string[]; description?: string; visibility?: "public" | "private"; avatarUrl?: string | null }>(req);

  if (body.action === "create") {
    // P2: validate the user-typed avatar URL before persisting.
    const avatar = validateOptionalUrl(body.avatarUrl);
    if (!avatar.ok) return bad(avatar.reason, 422);
    const name = (body.name ?? "").trim();
    const description = (body.description ?? "").trim();
    if (name.length < 3 || name.length > 48) return bad("Community name must be 3–48 characters.");
    if (description.length > 300) return bad("Description must be 300 characters or fewer.");
    // Server-side metadata screening (audit P3): the same narrow abuse rules
    // the composer applies — no ideological filtering, content-safety only.
    const metadataScreening = screenUserText([name, description].filter(Boolean).join(" "));
    if (!metadataScreening.allowed) return bad(metadataScreening.reason, 422);
    const tags = [...new Set((body.tags ?? body.tag?.split(",") ?? []).map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean))].slice(0, 8);
    const group: Group = {
      id: newId("g"), name, tag: tags[0] ?? "General", tags, description: description || "A new place to build together.",
      school: me.school === "Independent" ? null : me.school, createdAt: new Date().toISOString(),
      members: [{ userId: me.id, role: "admin", joinedAt: new Date().toISOString() }],
      visibility: body.visibility === "private" ? "private" : "public", avatarUrl: avatar.url,
      joinRequests: [], posts: [],
    };
    db.groups.push(group);
    await persist(db);
    return NextResponse.json({ ok: true, groupId: group.id }, { status: 201 });
  }

  const group = db.groups.find((g) => g.id === body.groupId);
  if (!group) return bad("Community not found.", 404);
  group.joinRequests ??= [];
  group.posts ??= [];
  const membership = group.members.find((m) => m.userId === me.id);
  if (body.action === "join") {
    if (membership) return json({ ok: true, status: "member", myRole: membership.role });
    if (group.visibility === "private") {
      if (!group.joinRequests.some((r) => r.userId === me.id)) group.joinRequests.push({ userId: me.id, requestedAt: new Date().toISOString() });
      await persist(db);
      return json({ ok: true, status: "pending" });
    }
    group.members.push({ userId: me.id, role: "member", joinedAt: new Date().toISOString() });
    await persist(db);
    return json({ ok: true, status: "member", myRole: "member" });
  }
  if (body.action === "leave") {
    if (membership?.role === "admin" && group.members.filter((m) => m.role === "admin").length === 1) return bad("Assign another admin before leaving.");
    group.members = group.members.filter((m) => m.userId !== me.id);
    group.joinRequests = group.joinRequests.filter((r) => r.userId !== me.id);
    await persist(db);
    return json({ ok: true, myRole: null });
  }
  return bad("Unknown action.");
}
