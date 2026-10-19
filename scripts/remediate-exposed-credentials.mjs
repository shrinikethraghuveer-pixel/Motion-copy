#!/usr/bin/env node
/**
 * P0-2 remediation (operator-invoked, one-shot, NEVER run from automation):
 *
 *   npm run remediate:plan       review only — no writes, prints redacted plan
 *   npm run remediate:execute    invalidate exactly the confirmed compromised
 *                                 legacy sessions from the working copy
 *   + --clear-password-hashes    also blank the password hashes of exactly the
 *                                 three accounts whose current hash matches the
 *                                 historical registry (EXPLICIT second flag)
 *
 * Safety properties:
 *  - target discovery the same way every run: the exposed value registry is
 *    re-derived from LOCAL git history (data/db.json blobs); the working copy
 *    is never assumed from a stale snapshot.
 *  - abort-on-mismatch: target counts must equal the expected audit numbers
 *    (10 sessions, 3 accounts) unless the operator passes --accept-counts to
 *    acknowledge deliberate drift; ambiguity aborts everything.
 *  - automatic backup: data/db.json is copied to
 *    data/db.json.pre-remediation-<timestamp> BEFORE any write (git-ignored),
 *    and the store is rewritten via tmp-file + rename, never partially.
 *  - unrelated data untouched: only matched session records are removed;
 *    only flagged account hashes are set to null. No DB reset, no bulk edit.
 *  - post-change verification: re-reads the written file and asserts every
 *    target value is gone and unrelated records survived.
 *  - deliberately refuses to run after the git history of data/db.json has
 *    been rewritten (the exposed registry becomes empty -> mismatch).
 *
 *  Privacy: tokens/hashes are NEVER printed; reports use sha256 8-char
 *  prefixes and public identifiers (ids/handles) only.
 *
 * Execution requires: --execute. This script exits 1/2 without writing.
 */
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import "../tests/register.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

// The pure logic module is imported by file URL (the loader maps "@/lib/db"
// to a stub; this script never touches it, and importing by relative path
// bypasses the stub mapping anyway).
const remediation = await import(pathToFileURL(path.join(root, "src", "lib", "credential-remediation.ts")).href);

const args = new Set(process.argv.slice(2));
const expectArg = (name) => {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
};

const EXPECTED_SESSIONS = args.has("--accept-counts") ? undefined : Number(expectArg("expected-sessions") ?? "10");
const EXPECTED_ACCOUNTS = args.has("--accept-counts") ? undefined : Number(expectArg("expected-accounts") ?? "3");
const DB_PATH = path.join(root, "data", "db.json");
const redacted = (secret) => createHash("sha256").update(secret).digest("hex").slice(0, 8);

function loadExposedRegistry() {
  const commits = execFileSync("git", ["log", "--format=%H", "--follow", "--", "data/db.json"], { encoding: "utf8", cwd: root })
    .trim().split("\n").filter(Boolean);
  if (commits.length === 0) {
    throw new Error("No Git history for data/db.json found — cannot derive the exposed registry. (History rewritten already?)");
  }
  const tokens = new Set();
  const hashes = new Set();
  for (const commit of commits) {
    const content = execFileSync("git", ["show", `${commit}:data/db.json`], { encoding: "utf8", cwd: root });
    for (const match of content.matchAll(/s_[a-f0-9]{20}/g)) tokens.add(match[0]);
    for (const match of content.matchAll(/(?:^|[^0-9a-f])([0-9a-f]{32}):([0-9a-f]{64})(?![0-9a-f])/g)) hashes.add(`${match[1]}:${match[2]}`);
  }
  if (tokens.size === 0 || hashes.size === 0) throw new Error("Exposed registry extracted from history is empty — refusing (history shape changed?).");
  return { commitCount: commits.length, tokens, hashes };
}

function loadStore() {
  if (!fs.existsSync(DB_PATH)) throw new Error("data/db.json is missing from the working tree.");
  const db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  if (!Array.isArray(db.users)) throw new Error("data/db.json has no users array (unexpected shape).");
  if (!Array.isArray(db.sessions)) throw new Error("data/db.json has no sessions array (unexpected shape).");
  return db;
}

async function backupStore() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${DB_PATH}.pre-remediation-${stamp}`;
  await fsp.copyFile(DB_PATH, backupPath);
  return backupPath;
}

function expectedCount(value, planned, label) {
  if (value === undefined) return true; // --accept-counts acknowledged
  if (planned === value) return true;
  throw new Error(`Aborting: planned ${label} count is ${planned}, expected ${value} (target drift). Fix expectations or pass --accept-counts.`);
}

const plannedDb = loadStore();
const registry = loadExposedRegistry();
const plan = remediation.collectRemediationPlan(plannedDb, registry.tokens, registry.hashes);
const currentFingerprint = createHash("sha256").update(fs.readFileSync(DB_PATH)).digest("hex");

console.log(`exposed registry: ${registry.commitCount} commits; ${registry.tokens.size} token values; ${registry.hashes.size} hash values`);
console.log(`current store fingerprint (sha256): ${currentFingerprint}`);
console.log(`plan: invalidate ${plan.sessions.length} session(s); ${plan.accounts.length} account hash(es) matched`);
for (const session of plan.sessions) {
  const owner = plannedDb.users.find((u) => u.id === session.userId);
  console.log(`  session ${redacted(session.token)} user=${session.userId} handle=${owner?.handle}`);
}
for (const account of plan.accounts) {
  const owner = plannedDb.users.find((u) => u.id === account.userId);
  console.log(`  account ${account.userId} handle=${owner?.handle}`);
}
console.log(`retired (history-only, no live match): ${plan.expiredTokens.length} tokens, ${plan.retiredHashes.length} hashes`);

try {
  expectedCount(EXPECTED_SESSIONS, plan.sessions.length, "session");
  expectedCount(EXPECTED_ACCOUNTS, plan.accounts.length, "account");
} catch (error) {
  console.error(`PLAN REJECTED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

if (!args.has("--execute")) {
  console.log("plan-only mode: nothing was written. Review the plan, then rerun with --execute.");
  process.exit(0);
}

// ---- execute ----
const backupPath = await backupStore();
console.log(`backup written: ${path.relative(root, backupPath)}`);

const targets = plan.sessions.map((s) => s.token);
const removed = remediation.invalidateExposedSessions(plannedDb, targets);
console.log(`invalidated ${removed} session record(s)`);

const clearedIds = new Set();
if (args.has("--clear-password-hashes")) {
  for (const account of plan.accounts) clearedIds.add(account.userId);
  const clearedCount = remediation.clearAccountPasswordHashes(plannedDb, [...clearedIds]);
  if (clearedCount !== plan.accounts.length) {
    console.error("post-change verification FAILED, store NOT rewritten (backup intact): cleared hash count mismatch.");
    process.exit(3);
  }
  console.log(`cleared passwordHash on ${clearedCount} account(s)`);
} else {
  console.log("password hashes left as-is (pass --clear-password-hashes to include them).");
}

const verified = remediation.verifyRemediation(plannedDb, registry.tokens, clearedIds);
if (!verified.ok) {
  console.error(`post-change verification FAILED, store NOT rewritten (backup intact):\n  ${verified.problems.join("\n  ")}`);
  process.exit(3);
}

const tmpPath = `${DB_PATH}.tmp-remediation`;
await fsp.writeFile(tmpPath, JSON.stringify(plannedDb, null, 2), "utf8");
const written = JSON.parse(fs.readFileSync(tmpPath, "utf8"));
if (written.users.length !== plannedDb.users.length || written.sessions.length !== plannedDb.sessions.length) {
  await fsp.unlink(tmpPath);
  console.error("re-read mismatch before rename; aborting without replacing the store.");
  process.exit(4);
}
await fsp.rename(tmpPath, DB_PATH);

// Final re-read of the real file on disk.
const finalDb = loadStore();
const finalVerified = remediation.verifyRemediation(finalDb, registry.tokens, clearedIds);
console.log(`post-write verification: ${finalVerified.ok ? "PASS" : `FAIL ${finalVerified.problems.join("; ")}`}`);
console.log(`sessions remaining: ${finalDb.sessions.length}; accounts: ${finalDb.users.length}`);
console.log("done. Restart any running dev server so in-memory state reloads.");
