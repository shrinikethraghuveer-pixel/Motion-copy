/**
 * Audit P0-2 remediation primitives (pure logic, no I/O):
 *
 * A Git-history incident exposed the legacy JSON store across five commits.
 * An operator-approved, one-shot remediation must invalidate exactly the
 * session records whose tokens appear in the exposed history and (optionally)
 * remove the password hashes of exactly the accounts whose *current* hash
 * matches an exposed value. Nothing else in the store may be touched.
 *
 * This module intentionally contains no persistence, no formatting of
 * sensitive values, and no knowledge of Git: the caller supplies the exposed
 * value sets and a parsed store, and receives a deterministic plan whose
 * ambiguity (a value matching 0 or >1 live records) is the caller's abort
 * signal.
 */

export interface SessionRecord {
  token: string;
  userId: string;
  [key: string]: unknown;
}

export interface UserRecord {
  id: string;
  passwordHash?: string | null;
  [key: string]: unknown;
}

export interface RemediationInput {
  users: UserRecord[];
  sessions: SessionRecord[];
  [key: string]: unknown;
}

export interface RemediationPlan {
  /** Live sessions whose token exactly equals an exposed historical value. */
  sessions: Array<{ token: string; userId: string }>;
  /** Accounts whose CURRENT passwordHash exactly equals an exposed value. */
  accounts: Array<{ userId: string }>;
  /** Exposed tokens present in history but not in the live store (expected). */
  expiredTokens: string[];
  /** Exposed hashes not found on any live account (expected). */
  retiredHashes: string[];
}

export function collectRemediationPlan(
  db: RemediationInput,
  exposedTokens: ReadonlySet<string>,
  exposedHashes: ReadonlySet<string>
): RemediationPlan {
  const sessions: RemediationPlan["sessions"] = [];
  const accounts: RemediationPlan["accounts"] = [];

  for (const token of exposedTokens) {
    const hits = db.sessions.filter((session) => session.token === token);
    if (hits.length > 1) {
      throw new Error(`Aborting: exposed token value matches ${hits.length} live sessions (ambiguous).`);
    }
    if (hits.length === 1) sessions.push({ token: hits[0].token, userId: hits[0].userId });
  }
  for (const hash of exposedHashes) {
    const hits = db.users.filter((user) => typeof user.passwordHash === "string" && user.passwordHash === hash);
    if (hits.length > 1) {
      throw new Error("Aborting: an exposed password-hash value matches multiple accounts (ambiguous).");
    }
    if (hits.length === 1) accounts.push({ userId: idsOf(hits[0]) });
  }

  return {
    sessions,
    accounts,
    expiredTokens: [...exposedTokens].filter(
      (token) => !db.sessions.some((session) => session.token === token)
    ),
    retiredHashes: [...exposedHashes].filter(
      (hash) => !db.users.some((user) => typeof user.passwordHash === "string" && user.passwordHash === hash)
    ),
  };
}

function idsOf(user: UserRecord): string {
  if (typeof user.id !== "string" || !user.id) throw new Error("Aborting: matched account has no usable id.");
  return user.id;
}

/** Removes exactly the session records carrying one of the given token values. */
export function invalidateExposedSessions(db: RemediationInput, tokenValues: Iterable<string>): number {
  const targets = new Set(tokenValues);
  const before = db.sessions.length;
  db.sessions = db.sessions.filter((session) => !targets.has(session.token));
  return before - db.sessions.length;
}

/** Clears passwordHash on exactly the given account ids. Others are untouched. */
export function clearAccountPasswordHashes(db: RemediationInput, userIds: Iterable<string>): number {
  const ids = new Set(userIds);
  let cleared = 0;
  for (const user of db.users) {
    if (ids.has(user.id) && typeof user.passwordHash === "string") {
      user.passwordHash = null;
      cleared += 1;
    }
  }
  return cleared;
}

/**
 * Password-reset primitives (operator-assisted reset): resolving ONE exact
 * target, snapshotting hash state, applying the new hash, and diffing the
 * snapshot so a post-write check can prove nothing else changed.
 */
export interface PasswordResetTarget {
  id: string;
  handle: string;
  previousHashLength: number | null;
}

export function resolvePasswordResetTarget(
  db: RemediationInput,
  key: { id?: string; handle?: string }
): PasswordResetTarget {
  const matches = db.users.filter((user) =>
    (key.id !== undefined && user.id === key.id) || (key.handle !== undefined && user.handle === key.handle)
  );
  if (matches.length === 0) throw new Error("Aborting: no account matches the target key.");
  if (matches.length > 1) throw new Error("Aborting: target key matches multiple accounts (ambiguous).");
  const user = matches[0];
  if (typeof user.id !== "string" || typeof user.handle !== "string") {
    throw new Error("Aborting: matched account has unusable id/handle fields.");
  }
  return {
    id: user.id,
    handle: user.handle,
    previousHashLength: typeof user.passwordHash === "string" ? user.passwordHash.length : null,
  };
}

export function hashSetSnapshot(db: RemediationInput): Map<string, string | null> {
  const snapshot = new Map<string, string | null>();
  for (const user of db.users) {
    snapshot.set(user.id, typeof user.passwordHash === "string" ? user.passwordHash : null);
  }
  return snapshot;
}

export function applyPasswordHash(db: RemediationInput, userId: string, passwordHash: string | null): void {
  const user = db.users.find((entry) => entry.id === userId);
  if (!user) throw new Error(`Aborting: target account ${userId} disappeared from the store.`);
  user.passwordHash = passwordHash;
}

/** Differences two snapshots; used as the post-write footprint check. */
export function changedAccounts(
  before: ReadonlyMap<string, string | null>,
  after: ReadonlyMap<string, string | null>
): Array<{ userId: string; direction: "set" | "cleared" }> {
  const changed: Array<{ userId: string; direction: "set" | "cleared" }> = [];
  for (const userId of new Set([...before.keys(), ...after.keys()])) {
    const beforeValue = before.has(userId) ? before.get(userId)! : null;
    const afterValue = after.has(userId) ? after.get(userId)! : null;
    if (beforeValue === afterValue) continue;
    changed.push({ userId, direction: afterValue ? "set" : "cleared" });
  }
  return changed;
}

/** Post-change invariants that must all hold before the store is rewritten. */
export function verifyRemediation(
  db: RemediationInput,
  exposedTokens: ReadonlySet<string>,
  clearedUserIds: ReadonlySet<string>
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  for (const session of db.sessions) {
    if (exposedTokens.has(session.token)) problems.push(`exposed token still present for user ${session.userId}`);
  }
  for (const userId of clearedUserIds) {
    const user = db.users.find((entry) => entry.id === userId);
    if (!user) problems.push(`target account ${userId} disappeared from the store`);
    else if (user.passwordHash !== null) problems.push(`account ${userId} passwordHash was not cleared to null`);
  }
  if (db.users.some((u) => typeof u.passwordHash === "string" && u.passwordHash === "")) {
    problems.push("an unrelated account hash was emptied");
  }
  return { ok: problems.length === 0, problems };
}
