/**
 * Audit P0-1 regression: the real src/lib/db.ts must fail CLOSED in
 * production (no auto-seed, no destructive recovery of a corrupt store) while
 * development keeps today's seed/recover behavior — upgraded to quarantine
 * the corrupt file instead of deleting it. Uses MOTION_DATA_DIR so the real
 * module never touches the repo's data/ directory.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fsSync from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Must precede the dynamic import: db.ts computes DATA_DIR at module load.
const fixtureRoot = fsSync.mkdtempSync(path.join(os.tmpdir(), "motion-db-prod-"));
process.env.MOTION_DATA_DIR = fixtureRoot;
Object.assign(process.env, { NODE_ENV: "test" });

type RealDbModule = typeof import("../src/lib/db.ts");
const realDb = (await import("../src/lib/db.ts")) as RealDbModule;

const DB_PATH = path.join(fixtureRoot, "db.json");

after(() => {
  fsSync.rmSync(fixtureRoot, { recursive: true, force: true });
});

function emptyFixture(): void {
  fsSync.rmSync(fixtureRoot, { recursive: true, force: true });
  fsSync.mkdirSync(fixtureRoot, { recursive: true });
}

function setNodeEnv(value: string): () => void {
  const prev = process.env.NODE_ENV;
  Object.assign(process.env, { NODE_ENV: value });
  return () => {
    Object.assign(process.env, { NODE_ENV: prev });
  };
}

function corruptFiles(): string[] {
  return fsSync.readdirSync(fixtureRoot).filter((name) => name.startsWith("db.json.corrupt-"));
}

test("MOTION_DATA_DIR redirects the store away from the repo data/ directory", async () => {
  emptyFixture();
  const restore = setNodeEnv("development");
  try {
    const at = await realDb.seedLocalDataStore();
    assert.equal(at, DB_PATH);
  } finally {
    restore();
  }
});

test("production + missing store: readDB fails closed and never auto-seeds", async () => {
  emptyFixture();
  const restore = setNodeEnv("production");
  try {
    await assert.rejects(
      realDb.readDB(),
      (error: unknown) => {
        assert.ok(error instanceof realDb.DataStoreUnavailableError, "typed operational error");
        assert.match((error as Error).message, /missing at/);
        assert.match((error as Error).message, /npm run seed:db/);
        return true;
      }
    );
    assert.equal(fsSync.existsSync(DB_PATH), false, "no db.json was silently recreated");
  } finally {
    restore();
  }
});

test("production + corrupt store: readDB fails closed and leaves the original bytes untouched", async () => {
  emptyFixture();
  const corruptBytes = `{"users":[{"id":"u_x"`; // deliberately truncated JSON
  fsSync.writeFileSync(DB_PATH, corruptBytes, "utf8");
  const restore = setNodeEnv("production");
  try {
    await assert.rejects(
      realDb.readDB(),
      (error: unknown) => {
        assert.ok(error instanceof realDb.DataStoreUnavailableError, "typed operational error");
        assert.match((error as Error).message, /corrupt or unreadable/);
        assert.match((error as Error).message, /refuses to modify it automatically/);
        return true;
      }
    );
    assert.equal(fsSync.readFileSync(DB_PATH, "utf8"), corruptBytes, "the original file was not deleted or rewritten");
    assert.deepEqual(corruptFiles(), [], "no quarantine churn in production either");
  } finally {
    restore();
  }
});

test("development + corrupt store: quarantines the original, then reseeds", async () => {
  emptyFixture();
  const corruptBytes = `not-json-{{{ ${Date.now()}`;
  fsSync.writeFileSync(DB_PATH, corruptBytes, "utf8");
  const restore = setNodeEnv("development");
  try {
    const db = await realDb.readDB();
    assert.equal(db.users.length > 0, true, "a fresh seed still serves development");
    const quarantined = corruptFiles();
    assert.equal(quarantined.length, 1, "exactly one quarantine copy");
    assert.equal(fsSync.readFileSync(path.join(fixtureRoot, quarantined[0]!), "utf8"), corruptBytes, "the broken file is preserved for inspection");
    const fresh = JSON.parse(fsSync.readFileSync(DB_PATH, "utf8")) as { users: unknown[] };
    assert.equal(fresh.users.length > 0, true, "db.json was rebuilt as a valid seed");
  } finally {
    restore();
  }
});

test("development + missing store: auto-seeds (existing behavior preserved)", async () => {
  emptyFixture();
  const restore = setNodeEnv("development");
  try {
    const db = await realDb.readDB();
    assert.equal(db.users.length > 0, true);
    assert.deepEqual(db.sessions, []);
    assert.equal(fsSync.existsSync(DB_PATH), true);
  } finally {
    restore();
  }
});

test("seedLocalDataStore creates when missing and refuses to overwrite", async () => {
  emptyFixture();
  const restore = setNodeEnv("production");
  try {
    const at = await realDb.seedLocalDataStore();
    assert.equal(at, DB_PATH);
    const parsed = JSON.parse(await fsp.readFile(DB_PATH, "utf8")) as { users: Array<{ handle: string }>; sessions: unknown[] };
    assert.equal(parsed.users.length > 0, true);
    assert.equal(Array.isArray(parsed.sessions), true);

    await assert.rejects(
      realDb.seedLocalDataStore(),
      (error: unknown) => {
        assert.ok(error instanceof realDb.DataStoreUnavailableError, "typed refusal");
        assert.match((error as Error).message, /Refusing to overwrite/);
        return true;
      }
    );
  } finally {
    restore();
  }
});
