import { promises as fs } from "fs";
import path from "path";
import { seedChats, seedConnections, seedGroups, seedNotifications, seedPosts, seedReports, seedUsers } from "@/lib/seed";
import type { DB } from "@/lib/schema";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "db.json");

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
    /* not present — fall through and seed */
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(
    DB_PATH,
    JSON.stringify(
      {
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
      } satisfies DB,
      null,
      2
    )
  );
}

export async function readDB(): Promise<DB> {
  await ensureSeeded();
  try {
    return normalize(JSON.parse(await fs.readFile(DB_PATH, "utf8")) as DB);
  } catch {
    // Corrupt or mid-write file: rebuild the seed rather than crash the API.
    await fs.rm(DB_PATH, { force: true });
    await ensureSeeded();
    return normalize(JSON.parse(await fs.readFile(DB_PATH, "utf8")) as DB);
  }
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
