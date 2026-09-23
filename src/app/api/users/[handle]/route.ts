import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { bad, hydratePost, json, requireUser, toPublicUser, withSettings } from "@/lib/server";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ handle: string }> }) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { me, db } = auth;
  const { handle } = await ctx.params;

  // Accept handle ("zoedesigns") or user id ("u_zoe") — notification tiles navigate by id.
  const user = db.users.find((u) => u.handle === handle || u.id === handle);
  if (!user) return bad("User not found.", 404);

  const posts = db.posts
    .filter((p) => p.authorId === user.id)
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

  const friendsOfUser = new Set(
    db.connections
      .filter((c) => c.status === "accepted" && (c.requesterId === user.id || c.targetId === user.id))
      .map((c) => (c.requesterId === user.id ? c.targetId : c.requesterId))
  );
  const connected = friendsOfUser.has(me.id);
  const isSelf = user.id === me.id;

  // Private accounts lock their content from everyone except connections; deactivated accounts lock from everyone.
  const locked = !isSelf && (!!user.deactivatedAt || (withSettings(user).privateProfile && !connected));

  const pubUser = toPublicUser(db, user, me.id);
  // School can be hidden from non-connections.
  if (!withSettings(user).showSchool && !isSelf && !connected) pubUser.school = "";

  const shownPosts = locked ? [] : posts;
  const highlights = shownPosts.filter((p) => p.type === "opportunity" || p.reposts.length > 2);
  const groups = locked ? [] : db.groups.filter((g) => g.members.some((m) => m.userId === user.id));

  return NextResponse.json({
    user: pubUser,
    locked,
    posts: shownPosts.map((p) => hydratePost(db, p, me.id)),
    highlights: highlights.map((p) => hydratePost(db, p, me.id)),
    clubs: groups.map((g) => ({
      id: g.id,
      name: g.name,
      tag: g.tag,
      role: g.members.find((m) => m.userId === user.id)?.role ?? "member",
      memberCount: g.members.length,
    })),
    stats: {
      connections: friendsOfUser.size,
      posts: shownPosts.length,
      following: user.following.length,
    },
  });
}

