import { NextRequest, NextResponse } from "next/server";
import { bad, json, persist, readBody, requireUser, toPublicUser } from "@/lib/server";
import { newId } from "@/lib/session";
import { screenUserText } from "@/lib/moderation";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { me, db } = auth;
  const { id } = await params;
  const group = db.groups.find((entry) => entry.id === id);
  if (!group) return bad("Community not found.", 404);
  const mine = group.members.find((member) => member.userId === me.id);
  const canView = group.visibility !== "private" || Boolean(mine);
  const canManage = mine?.role === "admin" || mine?.role === "moderator";
  return json({
    community: {
      id: group.id, name: group.name, tag: group.tag, tags: group.tags ?? [group.tag], description: group.description,
      school: group.school, visibility: group.visibility ?? "public", avatarUrl: group.avatarUrl ?? null,
      memberCount: group.members.length, myRole: mine?.role ?? null,
      myRequestStatus: mine ? "member" : group.joinRequests?.some((request) => request.userId === me.id) ? "pending" : "none",
      members: canView ? group.members.map((member) => {
        const user = db.users.find((entry) => entry.id === member.userId);
        return user ? { ...toPublicUser(db, user, me.id), role: member.role } : null;
      }).filter(Boolean) : [],
      requests: canManage ? (group.joinRequests ?? []).map((request) => {
        const user = db.users.find((entry) => entry.id === request.userId);
        return user ? { ...toPublicUser(db, user, me.id), requestedAt: request.requestedAt } : null;
      }).filter(Boolean) : [],
      posts: canView ? (group.posts ?? []).map((post) => ({
        ...post,
        author: (() => { const user = db.users.find((entry) => entry.id === post.authorId); return user ? toPublicUser(db, user, me.id) : null; })(),
        replies: post.replies.map((reply) => ({
          ...reply,
          author: (() => { const user = db.users.find((entry) => entry.id === reply.authorId); return user ? toPublicUser(db, user, me.id) : null; })(),
        })).filter((reply) => reply.author),
      })).sort((a, b) => Number(b.pinned) - Number(a.pinned) || +new Date(b.createdAt) - +new Date(a.createdAt)) : [],
    },
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { me, db } = auth;
  const { id } = await params;
  const group = db.groups.find((entry) => entry.id === id);
  if (!group) return bad("Community not found.", 404);
  const body = await readBody<{ action?: string; text?: string; postId?: string; userId?: string; decision?: "accept" | "decline"; role?: "moderator" | "member" }>(req);
  const mine = group.members.find((member) => member.userId === me.id);
  const isAdmin = mine?.role === "admin";
  const canModerate = isAdmin || mine?.role === "moderator";
  group.posts ??= [];
  group.joinRequests ??= [];
  if (body.action === "leave") {
    if (!mine) return bad("You are not a member of this community.", 403);
    if (mine.role === "admin" && group.members.filter((member) => member.role === "admin").length === 1) return bad("Assign another admin before leaving.");
    group.members = group.members.filter((member) => member.userId !== me.id);
    await persist(db);
    return json({ ok: true });
  }
  if (group.visibility === "private" && !mine) return bad("Join this private community to participate.", 403);

  if (body.action === "post" || body.action === "reply") {
    if (!mine) return bad("Join this community to post.", 403);
    const text = (body.text ?? "").trim();
    if (!text || text.length > 2000) return bad("Write a message up to 2,000 characters.");
    const screening = screenUserText(text);
    if (!screening.allowed) return bad(screening.reason, 422);
    if (body.action === "post") group.posts.unshift({ id: newId("cp"), authorId: me.id, text, createdAt: new Date().toISOString(), pinned: false, replies: [] });
    else {
      const post = group.posts.find((entry) => entry.id === body.postId);
      if (!post) return bad("Discussion not found.", 404);
      post.replies.push({ id: newId("cr"), authorId: me.id, text, createdAt: new Date().toISOString() });
    }
    await persist(db);
    return json({ ok: true });
  }

  if (body.action === "pin") {
    if (!canModerate) return bad("Moderator access required.", 403);
    const post = group.posts.find((entry) => entry.id === body.postId);
    if (!post) return bad("Discussion not found.", 404);
    post.pinned = !post.pinned;
    await persist(db);
    return json({ ok: true, pinned: post.pinned });
  }

  if (body.action === "review") {
    if (!canModerate) return bad("Moderator access required.", 403);
    const requestedUserId = body.userId;
    if (!requestedUserId || !["accept", "decline"].includes(body.decision ?? "")) return bad("Choose whether to accept or decline the request.");
    const requestIndex = group.joinRequests.findIndex((entry) => entry.userId === requestedUserId);
    if (requestIndex < 0) return bad("Join request not found.", 404);
    group.joinRequests.splice(requestIndex, 1);
    if (body.decision === "accept" && !group.members.some((member) => member.userId === requestedUserId)) {
      group.members.push({ userId: requestedUserId, role: "member", joinedAt: new Date().toISOString() });
    }
    await persist(db);
    return json({ ok: true });
  }

  if (body.action === "role") {
    if (!isAdmin) return bad("Only admins can assign moderator roles.", 403);
    const member = group.members.find((entry) => entry.userId === body.userId);
    if (!member || member.role === "admin") return bad("Choose a community member to update.");
    member.role = body.role === "moderator" ? "moderator" : "member";
    await persist(db);
    return json({ ok: true, role: member.role });
  }
  return NextResponse.json({ error: "Unknown community action." }, { status: 400 });
}
