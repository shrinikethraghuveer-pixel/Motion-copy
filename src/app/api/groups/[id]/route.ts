import { NextRequest, NextResponse } from "next/server";
import { bad, json, persist, readBody, requireUser, toPublicUser } from "@/lib/server";
import type { EventMeta, GroupDiscussionPost, PollMeta } from "@/lib/schema";
import type { DB, User } from "@/lib/schema";
import { newId } from "@/lib/session";
import { screenUserText } from "@/lib/moderation";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { validateMediaUrlList, validateOptionalUrl } from "@/lib/url-validation";

type Params = { params: Promise<{ id: string }> };

/** Community discussion post with viewer-safe interaction data (audit P7). */
function redactGroupPostForViewer(post: GroupDiscussionPost, db: DB, meId: string) {
  const hydrateUser = (userId: string) => {
    const user = db.users.find((entry) => entry.id === userId);
    return user ? toPublicUser(db, user, meId) : null;
  };
  const author = hydrateUser(post.authorId);
  if (!author) return null;
  return {
    ...post,
    poll: post.poll
      ? {
          question: post.poll.question,
          duration: post.poll.duration,
          multipleChoice: post.poll.multipleChoice,
          hideResults: post.poll.hideResults,
          totalVotes: post.poll.totalVotes,
          hasVoted: post.poll.options.some((option) => option.votes.includes(meId)),
          options: post.poll.options.map((option) => ({
            id: option.id,
            text: option.text,
            voteCount: option.votes.length,
            myVote: option.votes.includes(meId),
          })),
        }
      : null,
    event: post.event
      ? {
          title: post.event.title,
          date: post.event.date,
          location: post.event.location,
          kind: post.event.kind,
          endTime: post.event.endTime,
          durationMinutes: post.event.durationMinutes,
          capacity: post.event.capacity,
          category: post.event.category,
          posterUrl: post.event.posterUrl,
          link: post.event.link,
          attendeeCount: (post.event.attendeeIds ?? []).length,
          rsvpdByMe: (post.event.attendeeIds ?? []).includes(meId),
        }
      : null,
    author,
    replies: post.replies.map((reply) => ({
      ...reply,
      author: hydrateUser(reply.authorId),
    })).filter((reply) => reply.author),
  };
}

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
  // Audit 3C: enforce the composer's per-post audience. Members see every
  // post; non-member viewers of public communities only see posts explicitly
  // marked "Everyone". Posts that predate the composer have no audience value
  // and keep their historical community-page visibility.
  const viewerPosts = (group.posts ?? []).filter((post) => Boolean(mine) || !post.audience || post.audience === "Everyone");
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
      posts: canView ? viewerPosts.map((post) => redactGroupPostForViewer(post, db, me.id)).filter((post) => post !== null)
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || +new Date(b.createdAt) - +new Date(a.createdAt)) : [],
    },
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { me, db } = auth;
  // Audit P4: community post/reply/rsvp/vote/role writes were unthrottled.
  const rate = await rateLimit(req, "community-action", me.id, 20, 60);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfter);
  const { id } = await params;
  const group = db.groups.find((entry) => entry.id === id);
  if (!group) return bad("Community not found.", 404);
  const body = await readBody<{
    action?: string;
    group_id?: string;
    content?: string;
    audience_scope?: "Everyone" | "Community Only" | "Members Only";
    media_urls?: string[];
    gif_url?: string | null;
    poll_data?: { question?: string; options?: string[]; duration?: "1" | "3" | "7" | "0"; multipleChoice?: boolean; hideResults?: boolean };
    event_data?: { title?: string; date?: string; location?: string; kind?: string; endTime?: string; durationMinutes?: number; capacity?: number | null; category?: string; link?: string };
    text?: string;
    postId?: string;
    userId?: string;
    decision?: "accept" | "decline";
    role?: "moderator" | "member";
    type?: "standard" | "event" | "poll";
    audience?: "Everyone" | "Community Only" | "Members Only";
    mediaUrls?: string[];
    options?: string[];
    poll?: { question?: string; options?: string[]; duration?: "1" | "3" | "7" | "0"; multipleChoice?: boolean; hideResults?: boolean };
    event?: { title?: string; date?: string; location?: string; kind?: string; endTime?: string; durationMinutes?: number; capacity?: number | null; category?: string; link?: string };
  }>(req);
  if (body.group_id && body.group_id !== id) return bad("Community scope does not match this discussion.", 400);
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
    const text = (body.content ?? body.text ?? "").trim();
    if (text.length > 2000) return bad("Write a message up to 2,000 characters.");
    // Rich posts (poll/event/media) may carry only a caption — plain replies must have text.
    if (body.action === "reply" && !text) return bad("Write a message up to 2,000 characters.");
    const screening = screenUserText(
      [text, body.event?.title, body.event?.location, body.poll?.question, ...(body.poll?.options ?? [])].filter(Boolean).join(" ")
    );
    if (!screening.allowed) return bad(screening.reason, 422);
    if (body.action === "post") {
      // P2: every user-supplied URL (attachments, GIFs, event links) is
      // validated and rejected before persistence; posterUrl is derived from
      // the already-validated attachment list.
      const rawMediaUrls = body.media_urls ?? body.mediaUrls;
      const validatedMedia = Array.isArray(rawMediaUrls)
        ? validateMediaUrlList(rawMediaUrls)
        : { ok: true as const, urls: [] };
      if (!validatedMedia.ok) return bad(validatedMedia.reason, 422);
      const mediaUrls = validatedMedia.urls;
      const validatedGif = validateOptionalUrl(body.gif_url);
      if (!validatedGif.ok) return bad(validatedGif.reason, 422);
      const kind = body.type === "poll" ? "poll" : body.type === "event" ? "event" : "standard";
      const audienceScope = body.audience_scope ?? body.audience;
      const audience = audienceScope === "Everyone" || audienceScope === "Members Only" ? audienceScope : "Community Only";
      const pollInput = body.poll_data ?? body.poll;
      const eventInput = body.event_data ?? body.event;

      let poll: PollMeta | null = null;
      if (kind === "poll") {
        const options = (pollInput?.options ?? []).map((option) => option.trim()).filter(Boolean);
        if (!(pollInput?.question ?? "").trim()) return bad("Add a question to your poll.");
        if (options.length < 2 || options.length > 6) return bad("Polls need between 2 and 6 options.");
        poll = {
          question: pollInput!.question!.trim(),
          options: options.map((option, index) => ({ id: `option_${index + 1}`, text: option, votes: [] })),
          duration: pollInput?.duration ?? "1",
          multipleChoice: pollInput?.multipleChoice ?? false,
          hideResults: pollInput?.hideResults ?? false,
          totalVotes: 0,
        };
      }

      let event: EventMeta | null = null;
      if (kind === "event") {
        if (!eventInput?.title || !eventInput?.date || !eventInput?.location) return bad("Events need a title, date, and location.");
        const eventDate = new Date(eventInput.date);
        if (Number.isNaN(eventDate.getTime())) return bad("Enter a valid event date and time.");
        const capacity = eventInput.capacity ?? null;
        if (capacity !== null && (!Number.isInteger(capacity) || capacity < 2)) return bad("Event capacity must be at least 2.");
        const validatedLink = validateOptionalUrl(eventInput?.link);
        if (!validatedLink.ok) return bad(validatedLink.reason, 422);
        event = {
          title: eventInput.title.trim(),
          date: eventDate.toISOString(),
          location: eventInput.location.trim(),
          kind: eventInput.kind === "hackathon" ? "hackathon" : "event",
          endTime: eventInput.endTime || undefined,
          durationMinutes: eventInput.durationMinutes || undefined,
          capacity,
          category: eventInput.category,
          attendeeIds: [],
          posterUrl: mediaUrls[0] ?? null,
          link: validatedLink.url ?? undefined,
        };
      }

      if (kind === "standard" && !text && mediaUrls.length === 0) return bad("Write something or attach a visual first.");

      group.posts.unshift({
        id: newId("cp"),
        authorId: me.id,
        text,
        createdAt: new Date().toISOString(),
        pinned: false,
        audience,
        replies: [],
        mediaUrls: mediaUrls.length > 0 ? mediaUrls : null,
        poll,
        event,
      });
    } else {
      const post = group.posts.find((entry) => entry.id === body.postId);
      if (!post) return bad("Discussion not found.", 404);
      post.replies.push({ id: newId("cr"), authorId: me.id, text, createdAt: new Date().toISOString() });
    }
    await persist(db);
    return json({ ok: true });
  }

  if (body.action === "vote") {
    if (!mine) return bad("Join this community to vote.", 403);
    const post = group.posts.find((entry) => entry.id === body.postId);
    if (!post?.poll) return bad("Poll not found.", 404);
    // Audit 3E: parity with the main-feed poll expiry check (posts/[id]).
    const pollDuration = Number(post.poll.duration);
    if (pollDuration > 0 && Date.now() >= new Date(post.createdAt).getTime() + pollDuration * 86400000) return bad("This poll has ended.");
    const poll = post.poll;
    const selected = Array.isArray(body.options) ? body.options.filter((id): id is string => poll.options.some((option) => option.id === id)) : [];
    if (selected.length === 0) return bad("Choose a valid poll option.");
    if (!poll.multipleChoice && selected.length > 1) return bad("This poll allows one choice per person.");
    if (poll.options.some((option) => option.votes.includes(me.id)) && !poll.multipleChoice) return bad("You have already voted in this poll.");
    for (const option of poll.options) {
      if (selected.includes(option.id) && !option.votes.includes(me.id)) option.votes.push(me.id);
    }
    poll.totalVotes = new Set(poll.options.flatMap((option) => option.votes)).size;
    await persist(db);
    return json({ ok: true });
  }

  if (body.action === "rsvp") {
    if (!mine) return bad("Join this community to RSVP.", 403);
    const post = group.posts.find((entry) => entry.id === body.postId);
    if (!post?.event) return bad("Event not found.", 404);
    const attendees = post.event.attendeeIds ?? (post.event.attendeeIds = []);
    const index = attendees.indexOf(me.id);
    if (index >= 0) attendees.splice(index, 1);
    else {
      // Audit 3E: parity with the main-feed capacity check (posts/[id]).
      if (post.event.capacity && attendees.length >= post.event.capacity) return bad("This event is at capacity.");
      attendees.push(me.id);
    }
    await persist(db);
    return json({ ok: true, going: index < 0 });
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
