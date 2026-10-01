import { NextRequest, NextResponse } from "next/server";
import { bad, json, persist, readBody, requireUser, toPublicUser } from "@/lib/server";
import type { EventMeta, PollMeta } from "@/lib/schema";
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
      // Rich post — composer parity with the global feed.
      const rawMediaUrls = body.media_urls ?? body.mediaUrls;
      const mediaUrls = Array.isArray(rawMediaUrls)
        ? rawMediaUrls.filter((url): url is string => typeof url === "string" && url.length > 0).slice(0, 4)
        : [];
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
          link: eventInput.link || undefined,
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
    const poll = post.poll;
    const selected = Array.isArray(body.options) ? body.options.filter((id): id is string => poll.options.some((option) => option.id === id)) : [];
    if (selected.length === 0) return bad("Choose a valid poll option.");
    if (!poll.multipleChoice && selected.length > 1) return bad("This poll allows one choice per person.");
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
    else attendees.push(me.id);
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
