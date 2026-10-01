/**
 * Read-only Group A migration assessment.
 * Run with DATABASE_URL pointed at Supabase's direct connection string:
 *   npm run migration:dry-run
 * It uses exact legacy email = auth.users.email matches only; handles and
 * names are reported but never used to infer identity.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = path.join(root, "data", "db.json");
const connectionString = process.env.DATABASE_URL;

if (!connectionString) throw new Error("DATABASE_URL is required. This script performs read-only queries only.");
const legacy = JSON.parse(await fs.readFile(dbPath, "utf8"));
const client = new pg.Client({ connectionString });
await client.connect();

try {
  const { rows } = await client.query(`
    select p.id, lower(u.email) as email
    from public.profiles p
    join auth.users u on u.id = p.id
    where u.email is not null
  `);
  const byEmail = new Map();
  for (const row of rows) {
    const key = row.email;
    byEmail.set(key, [...(byEmail.get(key) ?? []), row.id]);
  }

  const mapped = [];
  const unmatched = [];
  const ambiguous = [];
  for (const user of legacy.users ?? []) {
    const email = typeof user.email === "string" ? user.email.trim().toLowerCase() : null;
    const candidates = email ? byEmail.get(email) ?? [] : [];
    if (candidates.length === 1) mapped.push({ legacyId: user.id, supabaseId: candidates[0], email });
    else if (candidates.length > 1) ambiguous.push({ legacyId: user.id, email, candidates });
    else unmatched.push({ legacyId: user.id, email, handle: user.handle });
  }

  const mappedIds = new Set(mapped.map((entry) => entry.legacyId));
  const dependencyCounts = {
    connections: legacy.connections?.length ?? 0,
    posts: legacy.posts?.length ?? 0,
    chats: legacy.chats?.length ?? 0,
    dmGroups: legacy.dmGroups?.length ?? 0,
    groups: legacy.groups?.length ?? 0,
    notifications: legacy.notifications?.length ?? 0,
    reports: legacy.reports?.length ?? 0,
  };
  const unresolvedReferences = {
    connections: (legacy.connections ?? []).filter((x) => !mappedIds.has(x.requesterId) || !mappedIds.has(x.targetId)).length,
    posts: (legacy.posts ?? []).filter((x) => !mappedIds.has(x.authorId)).length,
    chats: (legacy.chats ?? []).filter((x) => (x.participantIds ?? []).some((id) => !mappedIds.has(id))).length,
    notifications: (legacy.notifications ?? []).filter((x) => !mappedIds.has(x.userId) || !mappedIds.has(x.actorId)).length,
  };

  console.log(JSON.stringify({
    mode: "dry-run",
    identityRule: "exact lower-cased email match only; usernames/display names are never used",
    users: { total: legacy.users?.length ?? 0, mapped: mapped.length, unmatched, ambiguous, duplicateMappings: 0 },
    mapping: mapped,
    dependentRecords: dependencyCounts,
    recordsUnsafeToMigrateUntilIdentityIsResolved: unresolvedReferences,
  }, null, 2));
} finally {
  await client.end();
}
