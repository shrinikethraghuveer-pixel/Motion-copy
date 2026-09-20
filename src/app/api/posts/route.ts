import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { bad, hydratePost, persist, readBody, requireUser } from "@/lib/server";
import { newId } from "@/lib/session";
import type { Post } from "@/lib/schema";

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { me, db } = auth;
  const { searchParams } = new URL(req.url);
  const tab = searchParams.get("tab") ?? "for-you";
  const authorHandle = searchParams.get("author");

  const author = authorHandle ? db.users.find((u) => u.handle === authorHandle) : null;
  if (authorHandle && !author) return bad("Author not found.", 404);

  const friendIds = new Set(
    db.connections
      .filter((c) => c.status === "accepted" && (c.requesterId === me.id || c.targetId === me.id))
      .map((c) => (c.requesterId === me.id ? c.targetId : c.requesterId))
  );

  let list = [...db.posts];
  if (tab === "circle") {
    list = list.filter((p) => friendIds.has(p.authorId) || p.authorId === me.id);
  } else if (tab === "saved") {
    list = list.filter((p) => p.savedBy.includes(me.id));
  } else if (tab === "author") {
    list = list.filter((p) => p.authorId === author!.id);
  } else if (tab === "media") {
    list = list.filter((p) => p.media !== null);
  }

  list.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  return NextResponse.json({ posts: list.map((p) => hydratePost(db, p, me.id)) });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { me, db } = auth;
  const body = await readBody<{
    type?: "social" | "opportunity";
    text?: string;
    media?: { kind: "art"; seed: string; label: string } | null;
    event?: { title?: string; date?: string; location?: string; kind?: "internship" | "hackathon" | "event" };
  }>(req);

  const text = (body.text ?? "").trim();
  const media = body.media ?? null;
  if (!text && !media) return bad("Add something to post — text, a visual, or both.");
  if (text.length > 500) return bad("Free tier posts cap at 500 characters.", 413);

  let event: Post["event"] = null;
  if (body.type === "opportunity") {
    if (!body.event?.title || !body.event?.date) return bad("Opportunity posts need an event title and date.");
    event = {
      title: body.event.title.trim(),
      date: body.event.date,
      location: body.event.location?.trim() || "TBA",
      kind: body.event.kind ?? "event",
    };
  }

  const post: Post = {
    id: newId("p"),
    authorId: me.id,
    type: body.type === "opportunity" ? "opportunity" : "social",
    text,
    media,
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
