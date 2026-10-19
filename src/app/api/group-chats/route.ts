import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { bad, persist, readBody, requireUser, toPublicUser } from "@/lib/server";
import { newId } from "@/lib/session";
import type { ChatMessage, DmGroup } from "@/lib/schema";
import { screenUserText } from "@/lib/moderation";
import { isBlockedBetween, MAX_DM_GROUP_MEMBERS } from "@/lib/group-governance";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { validateOptionalUrl } from "@/lib/url-validation";

/** Shape returned in the sidebar list (no message bodies). */
interface GroupSummary {
  id: string;
  name: string;
  description: string;
  avatarUrl: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  lastMessage: ChatMessage | null;
  memberCount: number;
  meRole: "admin" | "member";
}

function summarize(g: DmGroup, meId: string): GroupSummary {
  const mine = g.members.find((m) => m.userId === meId);
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    avatarUrl: g.avatarUrl,
    createdBy: g.createdBy,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
    lastMessage: g.messages[g.messages.length - 1] ?? null,
    memberCount: g.members.length,
    meRole: mine?.role ?? "member",
  };
}

function findMine(db: { dmGroups: DmGroup[] }, groupId: string, meId: string): DmGroup | undefined {
  return db.dmGroups.find((g) => g.id === groupId && g.members.some((m) => m.userId === meId));
}

/** GET /api/group-chats — list my groups; `?groupId=` adds full history + roster. */
export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { me, db } = auth;

  const groupId = req.nextUrl.searchParams.get("groupId");
  if (groupId) {
    const g = findMine(db, groupId, me.id);
    if (!g) return bad("Group not found.", 404);
    const members = g.members
      .map((m) => {
        const u = db.users.find((x) => x.id === m.userId);
        return u ? { role: m.role, joinedAt: m.joinedAt, user: toPublicUser(db, u, me.id) } : null;
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);
    return NextResponse.json({ group: { ...summarize(g, me.id), members }, messages: g.messages });
  }

  const groups = db.dmGroups
    .filter((g) => g.members.some((m) => m.userId === me.id))
    .map((g) => summarize(g, me.id))
    .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
  return NextResponse.json({ groups });
}

/**
 * POST /api/group-chats — create, send, addMembers, leave.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { me, db } = auth;
  const rate = await rateLimit(req, "chat-write", me.id, 20, 60);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfter);

  const body = await readBody<{
    action?: "create" | "send" | "addMembers" | "leave";
    groupId?: string;
    name?: string;
    description?: string;
    avatarUrl?: string | null;
    memberIds?: string[];
    avatar_url?: string | null;
    member_ids?: string[];
    text?: string;
  }>(req);
  const action = body.action ?? "create";

  if (action === "create") {
    const avatar = validateOptionalUrl(body.avatar_url ?? body.avatarUrl);
    if (!avatar.ok) return bad(avatar.reason, 422);
    const name = (body.name ?? "").trim().slice(0, 60);
    if (!name) return bad("Group name is required.");
    const description = (body.description ?? "").trim().slice(0, 280);
    // Server-side metadata screening (audit P3): the same narrow abuse-screening
    // rules the composer uses — group names/descriptions are not a place for
    // abusive content. Rejections are content-safety only, no ideological
    // filtering.
    const screening = screenUserText([name, description].filter(Boolean).join(" "));
    if (!screening.allowed) return bad(screening.reason, 422);
    const requestedIds = [...new Set((body.member_ids ?? body.memberIds ?? []))];
    // 403 (not the bare 400) so membership-cap denials read like the other
    // governance denials instead of a generic validation error.
    if (requestedIds.length > MAX_DM_GROUP_MEMBERS) return bad(`Group chats are limited to ${MAX_DM_GROUP_MEMBERS} members.`, 403);
    // Membership/block governance (audit P3): a group chat must not place the
    // creator in a conversation with someone they blocked (or who blocked
    // them), and invites must go to active accounts only.
    const memberIds = requestedIds.filter((id) => {
      if (id === me.id) return false;
      const member = db.users.find((u) => u.id === id);
      return Boolean(member) && !member?.deactivatedAt && !isBlockedBetween(db, me.id, id);
    });
    if (memberIds.length !== requestedIds.length) {
      const rejectedNames = requestedIds
        .filter((id) => !memberIds.includes(id))
        .map((id) => db.users.find((u) => u.id === id)?.handle ?? id);
      return bad(`Some members couldn't be invited (blocked or unavailable): ${rejectedNames.join(", ")}.`, 403);
    }

    const now = new Date().toISOString();
    const group: DmGroup = {
      id: newId("gc"),
      name,
      description,
      avatarUrl: avatar.url,
      createdBy: me.id,
      members: [
        { userId: me.id, role: "admin", joinedAt: now },
        ...memberIds.map((userId) => ({ userId, role: "member" as const, joinedAt: now })),
      ],
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    db.dmGroups.push(group);
    await persist(db);
    return NextResponse.json({ ok: true, groupId: group.id });
  }

  if (action === "send") {
    const g = body.groupId ? findMine(db, body.groupId, me.id) : undefined;
    if (!g) return bad("Group not found.", 404);
    const text = (body.text ?? "").trim();
    if (!text) return bad("Message can't be empty.");
    if (text.length > 4000) return bad("Messages are limited to 4,000 characters.", 413);
    const screening = screenUserText(text);
    if (!screening.allowed) return bad(screening.reason, 422);

    const msg: ChatMessage = { id: newId("m"), senderId: me.id, text, createdAt: new Date().toISOString() };
    g.messages.push(msg);
    g.updatedAt = msg.createdAt;
    await persist(db);
    return NextResponse.json({ ok: true });
  }

  if (action === "addMembers") {
    const g = body.groupId ? findMine(db, body.groupId, me.id) : undefined;
    if (!g) return bad("Group not found.", 404);
    // Authorization (audit P3): the member-add UI is admins-only, and the
    // server now enforces the same rule against forged requests.
    const myRole = g.members.find((m) => m.userId === me.id)?.role;
    if (myRole !== "admin") return bad("Only group admins can add members.", 403);
    const requestedIds = [...new Set(body.memberIds ?? [])];
    if (requestedIds.length > MAX_DM_GROUP_MEMBERS) return bad(`Group chats are limited to ${MAX_DM_GROUP_MEMBERS} members.`, 403);
    for (const userId of requestedIds) {
      const member = db.users.find((u) => u.id === userId);
      if (!member || member.deactivatedAt) return bad(`That member is unavailable: ${userId}.`, 404);
      // Blocked-with-any-current-member check (audit P3): the candidate may
      // not join a conversation that already contains someone they blocked
      // (or who blocked them).
      if (isBlockedBetween(db, me.id, userId) || g.members.some((m) => m.userId !== userId && isBlockedBetween(db, m.userId, userId))) {
        return bad("You can't add someone who is blocked with a current member.", 403);
      }
    }
    const now = new Date().toISOString();
    let added = 0;
    for (const userId of requestedIds) {
      if (g.members.some((m) => m.userId === userId)) continue;
      g.members.push({ userId, role: "member", joinedAt: now });
      added += 1;
    }
    if (g.members.length > MAX_DM_GROUP_MEMBERS) return bad(`Group chats are limited to ${MAX_DM_GROUP_MEMBERS} members.`, 403);
    if (added > 0) g.updatedAt = now;
    await persist(db);
    return NextResponse.json({ ok: true, added });
  }

  if (action === "leave") {
    const g = body.groupId ? findMine(db, body.groupId, me.id) : undefined;
    if (!g) return bad("Group not found.", 404);
    g.members = g.members.filter((m) => m.userId !== me.id);
    if (g.members.length === 0) {
      db.dmGroups = db.dmGroups.filter((x) => x.id !== g.id);
    }
    await persist(db);
    return NextResponse.json({ ok: true });
  }

  return bad("Unknown action.");
}

export const dynamic = "force-dynamic";
