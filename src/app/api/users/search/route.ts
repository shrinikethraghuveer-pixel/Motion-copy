import type { NextRequest } from "next/server";
import { json, requireUser, toPublicUser, withSettings } from "@/lib/server";

/**
 * GET /api/users/search?q= — global user search for starting new chats.
 * Matches handle or display name (mirrors `username.ilike | full_name.ilike`
 * on Supabase). Respects discoverability, blocks, and deactivation.
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { me, db } = auth;

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  if (!q) return json({ users: [] });

  const mySettings = withSettings(me);
  const users = db.users
    .filter((u) => {
      if (u.id === me.id || u.deactivatedAt) return false;
      const us = withSettings(u);
      if (!us.discoverable) return false;
      if (us.blocked.includes(me.id) || mySettings.blocked.includes(u.id)) return false;
      return u.handle.toLowerCase().includes(q) || u.name.toLowerCase().includes(q);
    })
    .slice(0, 10)
    .map((u) => toPublicUser(db, u, me.id));

  return json({ users });
}

export const dynamic = "force-dynamic";
