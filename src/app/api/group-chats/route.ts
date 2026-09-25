import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { bad, persist, readBody, requireUser, toPublicUser } from "@/lib/server";
import { newId } from "@/lib/session";
import type { ChatMessage, DmGroup } from "@/lib/schema";
import { screenUserText } from "@/lib/moderation";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

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
    const name = (body.name ?? "").trim().slice(0, 60);
    if (!name) return bad("Group name is required.");
    const description = (body.description ?? "").trim().slice(0, 280);
    const avatarUrl = (body.avatar_url ?? body.avatarUrl)?.trim() || null;
    const memberIds = [...new Set((body.member_ids ?? body.memberIds ?? []).filter((id) => id !== me.id && db.users.some((u) => u.id === id)))];

    const now = new Date().toISOString();
    const group: DmGroup = {
      id: newId("gc"),
      name,
      description,
      avatarUrl,
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
    const now = new Date().toISOString();
    let added = 0;
    for (const userId of body.memberIds ?? []) {
      if (!db.users.some((u) => u.id === userId) || g.members.some((m) => m.userId === userId)) continue;
      g.members.push({ userId, role: "member", joinedAt: now });
      added += 1;
    }
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
