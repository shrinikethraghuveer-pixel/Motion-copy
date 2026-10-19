import { promises as fs } from "fs";
import path from "path";
import { seedChats, seedConnections, seedGroups, seedNotifications, seedPosts, seedReports, seedUsers } from "@/lib/seed";
import type { DB } from "@/lib/schema";

// Audit P0-1: the local JSON store location can be redirected with
// MOTION_DATA_DIR (tests and explicit ops tooling). Unset — cwd/data, as before.
const DATA_DIR = process.env.MOTION_DATA_DIR ? path.resolve(process.env.MOTION_DATA_DIR) : path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "db.json");

/**
 * Audit P0-1: thrown when the local JSON data store is missing or corrupt.
 * Production fails CLOSED — callers surface a clear 503 instead of silently
 * recreating demo data on the host.
 */
export class DataStoreUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataStoreUnavailableError";
  }
}

// Read at call time so tests can control the environment per case.
function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function freshSeed(): DB {
  return {
    users: seedUsers(),
    connections: seedConnections(),
    chats: seedChats(),
    dmGroups: [],
    posts: seedPosts(),
    groups: seedGroups(),
    notifications: seedNotifications(),
    sessions: [],
    loginEvents: [],
    reports: seedReports(),
  } satisfies DB;
}

let writeChain: Promise<void> = Promise.resolve();

/** Serialize writes so concurrent requests never clobber the JSON file. */
export function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function ensureSeeded(): Promise<void> {
  try {
    await fs.access(DB_PATH);
    return;
  } catch {
    /* not present — fall through */
  }
  if (isProduction()) {
    // Audit P0-1: production never auto-seeds the demo store. Fail closed.
    throw new DataStoreUnavailableError(
      `Local data store is missing at ${DB_PATH}. Production does not seed automatically — run \`npm run seed:db\` on the host to initialize it.`
    );
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DB_PATH, JSON.stringify(freshSeed(), null, 2));
}

export async function readDB(): Promise<DB> {
  await ensureSeeded();
  try {
    return normalize(JSON.parse(await fs.readFile(DB_PATH, "utf8")) as DB);
  } catch (error) {
    if (error instanceof DataStoreUnavailableError) throw error;
    if (isProduction()) {
      // Audit P0-1: never delete or rewrite a corrupt production store —
      // surface the failure so the operator can inspect the real bytes.
      throw new DataStoreUnavailableError(
        `Local data store at ${DB_PATH} is corrupt or unreadable. Production refuses to modify it automatically — restore it from backup or inspect the file manually.`
      );
    }
    // Dev: preserve the broken file for inspection (quarantine), then rebuild
    // the seed rather than crash the API.
    const quarantinedAt = `${DB_PATH}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    await fs.copyFile(DB_PATH, quarantinedAt).catch(() => undefined);
    await fs.rm(DB_PATH, { force: true });
    await ensureSeeded();
    return normalize(JSON.parse(await fs.readFile(DB_PATH, "utf8")) as DB);
  }
}

/**
 * Audit P0-1: explicit operator-invoked seeding (`npm run seed:db`). Creates
 * the store only when it is missing — refuses to overwrite an existing file.
 */
export async function seedLocalDataStore(): Promise<string> {
  try {
    await fs.access(DB_PATH);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(DB_PATH, JSON.stringify(freshSeed(), null, 2));
    return DB_PATH;
  }
  throw new DataStoreUnavailableError(`Refusing to overwrite an existing data store at ${DB_PATH}. Remove it only if you are certain nothing needs preserving.`);
}

/** Sensible ages for demo users created before the age field existed. */
const AGE_BY_HANDLE: Record<string, number> = {
  mayacodes: 19,
  "arjun.builds": 20,
  zoedesigns: 17,
  liamtech: 20,
  priyacodes: 16,
  samfilms: 17,
  avawrites: 13,
  noahlabs: 21,
  "mia.makes": 16,
  devdhillon: 20,
  emmacreates: 16,
  kaimotion: 19,
};

const AGE_BY_GRADE: Record<string, number> = { middle: 13, high: 16, college: 19 };

/** Fill collections added after the store was first seeded (no rewrite needed). */
function normalize(db: DB): DB {
  db.sessions ??= [];
  db.loginEvents ??= [];
  db.groups ??= [];
  db.dmGroups ??= [];
  for (const group of db.groups) {
    group.visibility ??= "public";
    group.avatarUrl ??= null;
    group.tags ??= group.tag ? [group.tag] : [];
    group.joinRequests ??= [];
    group.posts ??= [];
    for (const post of group.posts) post.replies ??= [];
  }
  // Backfill real ages so <18/18+ derives from age, not grade (high-schoolers can be 18+).
  for (const u of db.users) {
    if (typeof u.age !== "number" || u.age <= 0) {
      u.age = AGE_BY_HANDLE[u.handle] ?? AGE_BY_GRADE[u.grade] ?? 16;
    }
  }
  return db;
}

export async function writeDB(db: DB): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2));
}
