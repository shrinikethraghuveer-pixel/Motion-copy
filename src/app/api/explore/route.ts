import type { NextRequest } from "next/server";
import { hydratePost, json, requireUser, toPublicUser, withSettings } from "@/lib/server";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { me, db } = auth;
  // Audit 3F: discovery is scrape-prone; throttle per user.
  const throttle = await rateLimit(req, "explore-discovery", me.id, 60, 60);
  if (!throttle.allowed) return rateLimitResponse(throttle.retryAfter);
  const { searchParams } = new URL(req.url);
  const tag = searchParams.get("tag") ?? "All";
  const q = (searchParams.get("q") ?? "").trim().toLowerCase();
  // Bounded result set (audit P8); `limit` is honored up to a hard cap.
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 40, 1), 100);

  const mySettings = withSettings(me);
  const people = db.users
    .filter((u) => {
      if (u.id === me.id || u.deactivatedAt) return false;
      const us = withSettings(u);
      if (!us.discoverable) return false;
      if (us.blocked.includes(me.id) || mySettings.blocked.includes(u.id)) return false;
      if (tag !== "All" && !u.skills.includes(tag)) return false;
      if (q && !(`${u.name} ${u.handle} ${u.school} ${u.headline}`.toLowerCase().includes(q))) return false;
      return true;
    })
    .slice(0, limit)
    .map((u) => toPublicUser(db, u, me.id));

  const mediaPosts = db.posts
    .filter((p) => {
      if (!p.media || (tag !== "All" && !p.text.includes(tag))) return false;
      const author = db.users.find((u) => u.id === p.authorId);
      if (!author || author.deactivatedAt) return false;
      const authorSettings = withSettings(author);
      if (authorSettings.blocked.includes(me.id) || mySettings.blocked.includes(author.id)) return false;
      if (mySettings.muted.includes(author.id)) return false;
      const connected = db.connections.some((c) => c.status === "accepted" && ((c.requesterId === me.id && c.targetId === author.id) || (c.targetId === me.id && c.requesterId === author.id)));
      return !authorSettings.privateProfile || connected || author.id === me.id;
    })
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .slice(0, 18)
    .map((p) => hydratePost(db, p, me.id));

  return json({ people, mediaPosts, tags: ["All", "Coding", "Cricket", "UI/UX Design", "Video Editing", "Robotics", "AI", "Debate", "Photography", "Writing", "Music"] });
}
