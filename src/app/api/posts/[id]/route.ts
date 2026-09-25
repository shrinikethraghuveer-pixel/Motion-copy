import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { bad, hydratePost, persist, readBody, requireUser, shouldNotify, withSettings } from "@/lib/server";
import { newId } from "@/lib/session";
import type { Notification } from "@/lib/schema";
import { screenUserText } from "@/lib/moderation";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

type PostAction = "like" | "repost" | "comment" | "save" | "vote" | "rsvp";

function notify(db: import("@/lib/schema").DB, n: Omit<Notification, "id" | "createdAt" | "read">) {
  // Never notify about your own actions; respect the recipient's notification prefs.
  if (n.userId === n.actorId) return;
  if (!shouldNotify(db, n.userId, n.type)) return;
  db.notifications.unshift({ id: newId("n"), read: false, createdAt: new Date().toISOString(), ...n });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { me, db } = auth;
  const rate = await rateLimit(req, "post-action", me.id, 30, 60);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfter);
  const { id } = await ctx.params;
  const post = db.posts.find((p) => p.id === id);
  if (!post) return bad("Post not found.", 404);
  const author=db.users.find(u=>u.id===post.authorId);
  if(!author||author.deactivatedAt)return bad("Post not found.",404);
  const connected=db.connections.some(c=>c.status==="accepted"&&((c.requesterId===me.id&&c.targetId===author.id)||(c.targetId===me.id&&c.requesterId===author.id)));
  const viewerSettings=withSettings(me), authorSettings=withSettings(author);
  if((authorSettings.privateProfile&&!connected&&author.id!==me.id)||authorSettings.blocked.includes(me.id)||viewerSettings.blocked.includes(author.id)||viewerSettings.muted.includes(author.id))return bad("Post not found.",404);

  const body = await readBody<{ action?: PostAction; text?: string; optionIds?: string[] }>(req);

  switch (body.action) {
    case "like": {
      const i = post.likes.indexOf(me.id);
      if (i >= 0) post.likes.splice(i, 1);
      else {
        post.likes.push(me.id);
        notify(db, { userId: post.authorId, type: "like", actorId: me.id, postId: post.id, text: null });
      }
      break;
    }
    case "repost": {
      const i = post.reposts.indexOf(me.id);
      if (i >= 0) post.reposts.splice(i, 1);
      else {
        post.reposts.push(me.id);
        notify(db, { userId: post.authorId, type: "repost", actorId: me.id, postId: post.id, text: null });
      }
      break;
    }
    case "comment": {
      const text = (body.text ?? "").trim();
      if (!text) return bad("Comment can't be empty.");
      if (text.length > 1000) return bad("Comments are limited to 1,000 characters.", 413);
      const screening = screenUserText(text);
      if (!screening.allowed) return bad(screening.reason, 422);
      post.comments.push({ id: newId("c"), authorId: me.id, text, createdAt: new Date().toISOString() });
      notify(db, { userId: post.authorId, type: "comment", actorId: me.id, postId: post.id, text });
      break;
    }
    case "save": {
      const i = post.savedBy.indexOf(me.id);
      if (i >= 0) post.savedBy.splice(i, 1);
      else {
        post.savedBy.push(me.id);
        // Saving an opportunity syncs it into the My Space calendar (event posts only).
        if (post.event) {
          notify(db, { userId: post.authorId, type: "event", actorId: me.id, postId: post.id, text: null });
        }
      }
      break;
    }
    case "vote": {
      if (!post.poll) return bad("This post is not a poll.");
      const pollDuration = Number(post.poll.duration);
      if (pollDuration > 0 && Date.now() >= new Date(post.createdAt).getTime() + pollDuration * 86400000) return bad("This poll has ended.");
      const selected = [...new Set(body.optionIds ?? [])];
      if (!selected.length || selected.some((id) => !post.poll!.options.some((option) => option.id === id))) return bad("Choose a valid poll option.");
      if (!post.poll.multipleChoice && selected.length > 1) return bad("This poll allows one choice per person.");
      const alreadyVoted = post.poll.options.some((option) => option.votes.includes(me.id));
      if (alreadyVoted && !post.poll.multipleChoice) return bad("You have already voted in this poll.");
      for (const option of post.poll.options) {
        if (selected.includes(option.id) && !option.votes.includes(me.id)) option.votes.push(me.id);
      }
      post.poll.totalVotes = new Set(post.poll.options.flatMap((option) => option.votes)).size;
      break;
    }
    case "rsvp": {
      if (!post.event) return bad("This post is not an event.");
      const attendees = post.event.attendeeIds ?? (post.event.attendeeIds = []);
      const index = attendees.indexOf(me.id);
      if (index >= 0) attendees.splice(index, 1);
      else {
        if (post.event.capacity && attendees.length >= post.event.capacity) return bad("This event is at capacity.");
        attendees.push(me.id);
      }
      break;
    }
    default:
      return bad("Unknown action.");
  }

  await persist(db);
  return NextResponse.json({ post: hydratePost(db, post, me.id) });
}
