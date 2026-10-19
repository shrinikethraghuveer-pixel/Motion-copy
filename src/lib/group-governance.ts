/**
 * Shared membership governance rules (audit P3) for group chats / communities.
 * Server-side helpers so every enforcement point uses the same policy.
 */
import type { DB } from "@/lib/schema";
import { withSettings } from "@/lib/server";

/** Hard cap on members in one group chat (DM group chats). */
export const MAX_DM_GROUP_MEMBERS = 20;

/** True when either user has blocked the other (both directions checked). */
export function isBlockedBetween(
  db: Pick<DB, "users">,
  oneId: string,
  otherId: string
): boolean {
  const one = db.users.find((u) => u.id === oneId);
  const other = db.users.find((u) => u.id === otherId);
  if (!one || !other) return false;
  return (
    withSettings(one).blocked.includes(otherId) ||
    withSettings(other).blocked.includes(oneId)
  );
}
