import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { bad, persist, readBody, requireUser, toPublicUser, withSettings } from "@/lib/server";
import { newId } from "@/lib/session";
import type { Chat, ChatMessage, Notification } from "@/lib/schema";

/** GET /api/chats — thread summaries incl. pending Message Requests. */
export async function GET() {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { me, db } = auth;

  const threads = db.chats
    .filter((c) => c.participantIds.includes(me.id) && c.status !== "declined")
    .map((c) => {
      const otherId = c.participantIds.find((p) => p !== me.id)!;
      const other = db.users.find((u) => u.id === otherId)!;
      const last = c.messages[c.messages.length - 1] ?? null;
      return {
        id: c.id,
        status: c.status,
        requestedByMe: c.requestedBy === me.id,
        incomingFrom: c.status === "pending" && c.requestedBy !== me.id ? toPublicUser(db, other, me.id) : null,
        other: toPublicUser(db, other, me.id),
        lastMessage: last,
        unreadPreview: c.status === "pending" && c.requestedBy !== me.id,
        updatedAt: c.updatedAt,
      };
    })
    .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));

  return NextResponse.json({ threads });
}

/** POST /api/chats — open thread (pending if not connected), send message, accept or decline request. */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { me, db } = auth;
  const body = await readBody<{ targetHandle?: string; chatId?: string; text?: string; action?: "send" | "accept" | "decline" }>(req);
  const action = body.action ?? "send";

  let chat: Chat | undefined;

  if (action === "send") {
    const text = (body.text ?? "").trim();
    if (!text) return bad("Message can't be empty.");

    if (body.chatId) {
      chat = db.chats.find((c) => c.id === body.chatId && c.participantIds.includes(me.id));
      if (!chat) return bad("Conversation not found.", 404);
      if (chat.status === "declined") return bad("This conversation is closed.", 403);
      const otherId = chat.participantIds.find((p) => p !== me.id);
      const other = otherId ? db.users.find((u) => u.id === otherId) : undefined;
      if (other?.deactivatedAt) return bad("This account is no longer active.", 403);
      if (other && withSettings(other).blocked.includes(me.id)) return bad("You can't message this user.", 403);
    } else {
      const target = db.users.find((u) => u.handle === body.targetHandle);
      if (!target) return bad("User not found.", 404);
      if (target.id === me.id) return bad("You can't message yourself.");
      if (target.deactivatedAt) return bad("This account is no longer active.", 403);
      const targetSettings = withSettings(target);
      if (targetSettings.blocked.includes(me.id)) return bad("You can't message this user.", 403);
      if (targetSettings.allowDMs === "no_one") return bad("This student has direct messages turned off.", 403);
      const alreadyConnected = db.connections.some(
        (c) =>
          c.status === "accepted" &&
          ((c.requesterId === me.id && c.targetId === target.id) || (c.requesterId === target.id && c.targetId === me.id))
      );
      if (targetSettings.allowDMs === "connections" && !alreadyConnected) {
        return bad("Only connections can message this student — send a connect request first.", 403);
      }
      chat = db.chats.find(
        (c) => c.participantIds.length === 2 && c.participantIds.includes(me.id) && c.participantIds.includes(target.id)
      );
      if (!chat) {
        // DMs stay separate from connections: non-connected chats start pending for the recipient.
        const connected = db.connections.some(
          (c) =>
            c.status === "accepted" &&
            ((c.requesterId === me.id && c.targetId === target.id) || (c.requesterId === target.id && c.targetId === me.id))
        );
        chat = {
          id: newId("ch"),
          participantIds: [me.id, target.id],
          status: connected ? "active" : "pending",
          requestedBy: me.id,
          messages: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        db.chats.push(chat);
      }
    }

    const msg: ChatMessage = { id: newId("m"), senderId: me.id, text, createdAt: new Date().toISOString() };
    chat.messages.push(msg);
    chat.updatedAt = msg.createdAt;
    await persist(db);
    return NextResponse.json({ ok: true, chatId: chat.id, status: chat.status });
  }

  if (action === "accept" || action === "decline") {
    chat = db.chats.find((c) => c.id === body.chatId && c.participantIds.includes(me.id));
    if (!chat) return bad("Conversation not found.", 404);
    if (chat.requestedBy === me.id) return bad("Only the recipient can respond to a request.");
    if (action === "accept") {
      chat.status = "active";
    } else {
      // Silent decline: no notification, no trace for the sender. Chat removed.
      db.chats = db.chats.filter((c) => c.id !== chat!.id);
    }
    await persist(db);
    return NextResponse.json({ ok: true, status: action === "accept" ? "active" : "declined" });
  }

  return bad("Unknown action.");
}

export const dynamic = "force-dynamic";
