import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { bad, hydratePost, json, requireUser, toPublicUser, withSettings } from "@/lib/server";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

export async function GET(req: NextRequest, ctx: { params: Promise<{ handle: string }> }) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { me, db } = auth;
  // Audit 3F: profile scraping guard; generous for normal in-app navigation.
  const throttle = await rateLimit(req, "user-profile-view", me.id, 240, 60);
  if (!throttle.allowed) return rateLimitResponse(throttle.retryAfter);
  const { handle } = await ctx.params;

  // Accept handle ("zoedesigns") or user id ("u_zoe") — notification tiles navigate by id.
  const user = db.users.find((u) => u.handle === handle || u.id === handle);
  if (!user) return bad("User not found.", 404);
  const viewerSettings=withSettings(me);
  if(withSettings(user).blocked.includes(me.id)||viewerSettings.blocked.includes(user.id))return bad("User not found.",404);

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
  // Bounded result set (audit P8): profile payloads cap post history; `limit`
  // is honored up to a hard cap.
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit")) || 30, 1), 100);
  const highlights = shownPosts.filter((p) => p.type === "opportunity" || p.reposts.length > 2).slice(0, 6);
  const groups = locked ? [] : db.groups.filter((g) => g.members.some((m) => m.userId === user.id)).slice(0, 50);

  return NextResponse.json({
    user: pubUser,
    locked,
    posts: shownPosts.slice(0, limit).map((p) => hydratePost(db, p, me.id)),
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
