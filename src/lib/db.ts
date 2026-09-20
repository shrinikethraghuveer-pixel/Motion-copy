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
        posts: seedPosts(),
        groups: seedGroups(),
        notifications: seedNotifications(),
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
    return JSON.parse(await fs.readFile(DB_PATH, "utf8")) as DB;
  } catch {
    // Corrupt or mid-write file: rebuild the seed rather than crash the API.
    await fs.rm(DB_PATH, { force: true });
    await ensureSeeded();
    return JSON.parse(await fs.readFile(DB_PATH, "utf8")) as DB;
  }
}

export async function writeDB(db: DB): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2));
}
