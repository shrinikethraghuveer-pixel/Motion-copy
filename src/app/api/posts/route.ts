import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { bad, hydratePost, persist, readBody, requireUser, withSettings } from "@/lib/server";
import { newId } from "@/lib/session";
import type { Post } from "@/lib/schema";
import { screenUserText } from "@/lib/moderation";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { validateMediaUrlList } from "@/lib/url-validation";

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { me, db } = auth;
  const { searchParams } = new URL(req.url);
  const tab = searchParams.get("tab") ?? "for-you";  const authorHandle = searchParams.get("author");
  const communityId = searchParams.get("community");

  const author = authorHandle ? db.users.find((u) => u.handle === authorHandle) : null;
  if (authorHandle && !author) return bad("Author not found.", 404);

  const friendIds = new Set(
    db.connections
      .filter((c) => c.status === "accepted" && (c.requesterId === me.id || c.targetId === me.id))
      .map((c) => (c.requesterId === me.id ? c.targetId : c.requesterId))
  );
  const mySettings = withSettings(me);
  const authorHidden = (authorId: string) => {
    const a = db.users.find((u) => u.id === authorId);
    if (!a) return true; // deleted
    if (a.deactivatedAt) return true;
    const as = withSettings(a);
    if (as.blocked.includes(me.id) || mySettings.blocked.includes(authorId)) return true;
    if (mySettings.muted.includes(authorId)) return true;
    if (as.privateProfile && !friendIds.has(authorId) && authorId !== me.id) return true;
    return false;
  };

  let list = [...db.posts].filter((p) => !authorHidden(p.authorId));
  if (tab === "circle" || tab === "following") {
    list = list.filter((p) => friendIds.has(p.authorId) || p.authorId === me.id);
  } else if (tab === "communities") {
    const community = db.groups.find((group) => group.id === communityId && group.members.some((member) => member.userId === me.id));
    if (!community) {
      list = [];
    } else {
      const memberIds = new Set(community.members.map((member) => member.userId));
      const tag = community.tag.toLowerCase();
      list = list.filter((post) => memberIds.has(post.authorId) || post.text.toLowerCase().includes(tag));
    }
  } else if (tab === "saved") {
    list = list.filter((p) => p.savedBy.includes(me.id));
  } else if (tab === "author") {
    list = list.filter((p) => p.authorId === author!.id);
  } else if (tab === "media") {
    list = list.filter((p) => p.media !== null);
  }

  list.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  // Bounded result set (audit P8); `limit` is honored up to a hard cap.
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 50, 1), 100);
  list = list.slice(0, limit);
  return NextResponse.json({ posts: list.map((p) => hydratePost(db, p, me.id)) });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { me, db } = auth;
  const rate = await rateLimit(req, "post-create", me.id, 8, 60);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfter);
  const body = await readBody<{
    type?: "standard" | "social" | "opportunity" | "poll" | "event";
    text?: string;
    audience?: string;
    media?: { kind: "art"; seed: string; label: string } | null;
    mediaUrls?: string[];
    poll?: { question?: string; options?: string[]; duration?: "1" | "3" | "7" | "0"; votesPerUser?: 1 | 99; hideResults?: boolean };
    event?: { title?: string; date?: string; time?: string; endTime?: string; duration?: string; venue?: string; capacity?: string; category?: string };
  }>(req);

  const text = (body.text ?? "").trim();
  const media = body.media ?? null;
  // Server-side validation (P2): scheme/credentials/length/count checks before persistence.
  const validatedMedia = Array.isArray(body.mediaUrls)
    ? validateMediaUrlList(body.mediaUrls)
    : { ok: true as const, urls: [] };
  if (!validatedMedia.ok) return bad(validatedMedia.reason, 422);
  const mediaUrls = validatedMedia.urls;
  const postKind = body.type === "poll" ? "poll" : body.type === "event" || body.type === "opportunity" ? "event" : "text";
  if (postKind === "poll" && !(body.poll?.question ?? "").trim()) return bad("Add a question to your poll.");
  if (!text && !media && mediaUrls.length === 0 && postKind === "text") return bad("Add something to post - text, a visual, or both.");
  const screening = screenUserText([text, body.media?.label, body.event?.title, body.event?.venue, body.poll?.question, ...(body.poll?.options ?? [])].filter(Boolean).join(" "));
  if (!screening.allowed) return bad(screening.reason, 422);

  let event: Post["event"] = null;
  if (postKind === "event") {
    if (!body.event?.title || !body.event?.date || !body.event?.time || !body.event?.venue) return bad("Events need a title, date, start time, and venue.");
    const eventDate = new Date(`${body.event.date}T${body.event.time}`);
    if (Number.isNaN(eventDate.getTime())) return bad("Enter a valid event date and time.");
    const capacity = body.event.capacity ? Number(body.event.capacity) : null;
    if (capacity !== null && (!Number.isInteger(capacity) || capacity < 2)) return bad("Event capacity must be at least 2.");
    event = {
      title: body.event.title.trim(),
      date: eventDate.toISOString(),
      location: body.event.venue.trim(),
      kind: body.event.category?.toLowerCase() === "hackathon" ? "hackathon" : "event",
      endTime: body.event.endTime,
      durationMinutes: Number(body.event.duration) || undefined,
      capacity,
      category: body.event.category,
      attendeeIds: [],
      posterUrl: mediaUrls[0] ?? null,
    };
  }

  let poll: Post["poll"] = null;
  if (postKind === "poll") {
    const options = (body.poll?.options ?? []).map((value) => value.trim()).filter(Boolean);
    if (options.length < 2 || options.length > 6) return bad("Polls need between 2 and 6 options.");
    poll = {
      question: body.poll!.question!.trim(),
      options: options.map((option, index) => ({ id: `option_${index + 1}`, text: option, votes: [] })),
      duration: body.poll?.duration ?? "1",
      multipleChoice: body.poll?.votesPerUser === 99,
      hideResults: body.poll?.hideResults ?? false,
      totalVotes: 0,
    };
  }

  if (me.deactivatedAt) return bad("Reactivate your account to post again.", 403);

  const post: Post = {
    id: newId("p"),
    authorId: me.id,
    type: postKind === "poll" ? "poll" : postKind === "event" ? "opportunity" : "social",
    text,
    media,
    mediaUrls,
    poll,
    likes: [],
    reposts: [],
    comments: [],
    savedBy: [],
    event,
    createdAt: new Date().toISOString(),
  };
  db.posts.unshift(post);
  await persist(db);
  return NextResponse.json({ post: hydratePost(db, post, me.id) }, { status: 201 });
}
