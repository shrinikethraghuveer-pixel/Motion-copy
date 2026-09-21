import { json, requireUser, toPublicUser, withSettings } from "@/lib/server";
import type { SuggestedUser } from "@/lib/schema";

export async function GET() {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const { me, db } = auth;

  const connectedIds = new Set(
    db.connections
      .filter((c) => c.status === "accepted" && (c.requesterId === me.id || c.targetId === me.id))
      .map((c) => (c.requesterId === me.id ? c.targetId : c.requesterId))
  );
  const pendingIds = new Set(
    db.connections
      .filter((c) => c.status === "pending" && (c.requesterId === me.id || c.targetId === me.id))
      .map((c) => (c.requesterId === me.id ? c.targetId : c.requesterId))
  );

  const mySettings = withSettings(me);
  const suggestions: SuggestedUser[] = [];
  for (const u of db.users) {
    if (u.id === me.id || connectedIds.has(u.id) || pendingIds.has(u.id)) continue;
    if (u.deactivatedAt) continue;
    const uSettings = withSettings(u);
    if (!uSettings.discoverable) continue;
    // Blocked or muted (either direction) never surface as suggestions.
    if (uSettings.blocked.includes(me.id) || mySettings.blocked.includes(u.id)) continue;
    if (uSettings.muted.includes(me.id) || mySettings.muted.includes(u.id)) continue;

    // mutual connections: friends of mine who are connected to u
    let mutualCount = 0;
    const myFriends = [...connectedIds];
    for (const fId of myFriends) {
      const mutual = db.connections.some(
        (c) =>
          c.status === "accepted" &&
          ((c.requesterId === fId && c.targetId === u.id) || (c.requesterId === u.id && c.targetId === fId))
      );
      if (mutual) mutualCount++;
    }

    const sharedSkills = mySettings.personalizeSuggestions ? u.skills.filter((s) => me.skills.includes(s)) : [];

    if (mutualCount === 0 && sharedSkills.length === 0) continue;
    const mutualsLabel = mutualCount === 1 ? "1 mutual connection" : `${mutualCount} mutual connections`;
    const reason = mutualCount > 0 && sharedSkills.length > 0
      ? `${mutualsLabel} · both into ${sharedSkills[0]}`
      : mutualCount > 0
        ? mutualsLabel
        : `Both into ${sharedSkills.join(", ")}`;

    suggestions.push({ user: toPublicUser(db, u, me.id), mutualCount, sharedSkills, reason });
  }

  // Fallback: if not enough algorithmic matches, surface most-recent active students
  if (suggestions.length < 3) {
    const extras = db.users
      .filter((u) => {
        if (u.id === me.id || u.deactivatedAt) return false;
        if (connectedIds.has(u.id) || pendingIds.has(u.id)) return false;
        if (suggestions.some((s) => s.user.id === u.id)) return false;
        const us = withSettings(u);
        if (!us.discoverable || us.blocked.includes(me.id) || mySettings.blocked.includes(u.id)) return false;
        if (us.muted.includes(me.id) || mySettings.muted.includes(u.id)) return false;
        return true;
      })
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
      .slice(0, 4 - suggestions.length);
    for (const u of extras) {
      suggestions.push({ user: toPublicUser(db, u, me.id), mutualCount: 0, sharedSkills: [], reason: "Active on Motion" });
    }
  }

  suggestions.sort((a, b) => b.mutualCount - a.mutualCount || b.sharedSkills.length - a.sharedSkills.length);
  return json({ suggestions: suggestions.slice(0, 6) });
}
