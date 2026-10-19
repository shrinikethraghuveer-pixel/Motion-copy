import { NextResponse } from "next/server";
import { requireUser, toPublicUser, withSettings } from "@/lib/server";
import { createClient } from "@/lib/supabase/server";

type ProfileRow = {
  id: string;
  username: string;
  full_name: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

const asSuggested = (rows: ProfileRow[]) => rows.map((profile) => ({
  id: profile.id,
  handle: profile.username,
  name: profile.display_name || profile.full_name || profile.username,
  photo: profile.avatar_url,
  subtitle: "Suggested based on activity",
}));

export async function GET(request: Request) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { me, db } = auth;
  const requestedLimit = Number(new URL(request.url).searchParams.get("limit") ?? "5");
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.floor(requestedLimit), 1), 30) : 5;

  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: links, error: linksError } = await supabase
          .from("connections")
          .select("requester_id,target_id,status")
          .or(`requester_id.eq.${user.id},target_id.eq.${user.id}`)
          .in("status", ["accepted", "pending"]);
        if (linksError) throw linksError;

        const excluded = new Set<string>([user.id]);
        for (const link of links ?? []) excluded.add(link.requester_id === user.id ? link.target_id : link.requester_id);

        // Discovery, blocking, and deactivation policy is enforced by the
        // search_discoverable_profiles RLS helper (migration 0015), which the
        // local fallback mirrors via the discoverable filter below. An empty
        // search text matches every eligible profile.
        const { data: discovered, error: candidateError } = await supabase.rpc(
          "search_discoverable_profiles",
          { p_search_text: "", p_result_limit: Math.max(limit * 5, 25) }
        );
        if (candidateError) throw candidateError;

        const candidates = ((discovered ?? []) as ProfileRow[]).filter((profile) => !excluded.has(profile.id)).slice(0, limit);
        if (candidates.length >= 3) return NextResponse.json({ users: asSuggested(candidates) }, { status: 200 });

        // Sparse unconnected candidates are common for new communities. Keep
        // the widget useful by relaxing only the connection exclusion.
        const relaxed = ((discovered ?? []) as ProfileRow[]).slice(0, limit);
        return NextResponse.json({ users: asSuggested(relaxed) }, { status: 200 });
      }
    } catch (error) {
      console.warn("[users/suggested] Supabase query failed; using local profiles", error);
    }
  }

  const excluded = new Set<string>([me.id]);
  for (const link of db.connections) {
    if (link.requesterId === me.id) excluded.add(link.targetId);
    if (link.targetId === me.id) excluded.add(link.requesterId);
  }
  // Local fallback mirrors /api/users/search: discoverable + not deactivated
  // + no block in either direction.
  const mySettings = withSettings(me);
  const available = db.users
    .filter((profile) => {
      if (profile.deactivatedAt) return false;
      const us = withSettings(profile);
      if (!us.discoverable) return false;
      if (us.blocked.includes(me.id) || mySettings.blocked.includes(profile.id)) return false;
      return true;
    })
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const mutualCount = (candidateId: string) => {
    const mine = new Set(db.connections.filter((link) => link.status === "accepted" && (link.requesterId === me.id || link.targetId === me.id)).map((link) => link.requesterId === me.id ? link.targetId : link.requesterId));
    const theirs = new Set(db.connections.filter((link) => link.status === "accepted" && (link.requesterId === candidateId || link.targetId === candidateId)).map((link) => link.requesterId === candidateId ? link.targetId : link.requesterId));
    return [...mine].filter((id) => theirs.has(id)).length;
  };
  const filtered = available.filter((profile) => !excluded.has(profile.id)).sort((a, b) => mutualCount(b.id) - mutualCount(a.id) || +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, limit);
  const users = filtered.length >= 3
    ? filtered
    : available.filter((profile) => profile.id !== me.id).slice(0, limit);
  return NextResponse.json({ users: users.map((profile) => {
    const mutuals = mutualCount(profile.id);
    return { ...toPublicUser(db, profile, me.id), subtitle: mutuals > 0 ? `${mutuals} mutual connection${mutuals === 1 ? "" : "s"}` : "Popular in Motion", mutualCount: mutuals };
  }) }, { status: 200 });
}

export const dynamic = "force-dynamic";
