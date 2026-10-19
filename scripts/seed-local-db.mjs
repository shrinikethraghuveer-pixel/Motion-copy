// Audit P0-1: explicit, operator-invoked seeding of the local JSON data store.
//
//   npm run seed:db
//
// The app itself never seeds automatically in production (src/lib/db.ts fail
// closed), so missing hosts must run THIS to create data/db.json. It refuses
// to overwrite an existing store — no destructive behavior.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import "../tests/register.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

// Direct file URL import — the test loader maps "@/lib/db" to a stub, so the
// real module is loaded by path. Its "@/lib/seed" import resolves through the
// registered loader to the real source.
const db = await import(pathToFileURL(path.join(root, "src", "lib", "db.ts")).href);

try {
  const at = await db.seedLocalDataStore();
  console.log(`Seeded local data store at ${at}`);
} catch (error) {
  console.error(`seed:db failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
