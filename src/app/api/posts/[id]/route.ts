import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { bad, hydratePost, persist, readBody, requireUser } from "@/lib/server";
import { newId } from "@/lib/session";
import type { Notification } from "@/lib/schema";

type PostAction = "like" | "repost" | "comment" | "save";

function notify(db: import("@/lib/schema").DB, n: Omit<Notification, "id" | "createdAt" | "read">) {
  // Never notify about your own actions.
  if (n.userId === n.actorId) return;
  db.notifications.unshift({ id: newId("n"), read: false, createdAt: new Date().toISOString(), ...n });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { me, db } = auth;
  const { id } = await ctx.params;
  const post = db.posts.find((p) => p.id === id);
  if (!post) return bad("Post not found.", 404);

  const body = await readBody<{ action?: PostAction; text?: string }>(req);

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
    default:
      return bad("Unknown action.");
  }

  await persist(db);
  return NextResponse.json({ post: hydratePost(db, post, me.id) });
}
