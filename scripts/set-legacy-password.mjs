#!/usr/bin/env node
/**
 * Operator-assisted legacy password reset (single account, NEVER automated):
 *
 *   npm run reset-legacy-password -- --handle <handle>
 *   npm run reset-legacy-password -- --id <userId> --password-file <path>
 *
 * exactly one of --id / --handle must be supplied. The new password is
 * collected either interactively (secret prompt, no echo) or from a local
 * file. It is NEVER accepted as a CLI argument, never echoed, never logged,
 * and never written anywhere — only the scrypt hash from the application's
 * own hashPassword() reaches the store.
 *
 * Safety properties (same disciplines as remediate-exposed-credentials.mjs):
 *  - exact-target resolution via resolvePasswordResetTarget: zero matches or
 *    an ambiguous key aborts BEFORE any backup or mutation.
 *  - automatic backup: data/db.json is copied to
 *    data/db.json.pre-password-reset-<timestamp> BEFORE the store replace
 *    (git-ignored).
 *  - footprint proof: a pre-change hash snapshot is diffed against the
 *    mutated copy; the diff must be exactly ["target -> set"] or the run
 *    aborts and nothing is written.
 *  - password round-trip: the new hash is verified with the application's
 *    verifyPassword() before and after the write.
 *  - atomic replace: the store is rewritten via tmp-file + rename, never
 *    partially, and re-read afterwards; mismatch exits 4.
 *
 *  Privacy: the password candidate and its hash are never printed; the
 *  report shows the account id/handle and a sha256 8-char fingerprint of
 *  the new hash only.
 *
 * Exit codes: 0 success; 2 usage/precheck abort; 3 footprint/verification
 * failure (store NOT rewritten); 4 re-read mismatch after rename.
 */
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";
import "../tests/register.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const remediation = await import(pathToFileURL(path.join(root, "src", "lib", "credential-remediation.ts")).href);
const auth = await import(pathToFileURL(path.join(root, "src", "lib", "auth.ts")).href);

const DB_PATH = path.join(root, "data", "db.json");

/** Pure arg parsing (exported for tests). Throws on insecure usage. */
export function parseResetArgs(argv) {
  const usage = "usage: node scripts/set-legacy-password.mjs (--id <userId> | --handle <handle>) [--password-file <path>]";
  const rest = [...argv];
  const parsed = { id: undefined, handle: undefined, passwordFile: undefined, help: false };
  while (rest.length > 0) {
    const flag = rest.shift();
    if (flag === "--help" || flag === "-h") {
      parsed.help = true;
      continue;
    }
    if (flag !== "--id" && flag !== "--handle" && flag !== "--password-file") {
      throw new Error(`unknown argument ${flag}; ${usage}`);
    }
    const value = rest.shift();
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`missing value for ${flag}; ${usage}`);
    }
    if (flag === "--password-file") parsed.passwordFile = value;
    if (flag === "--id") parsed.id = value;
    if (flag === "--handle") parsed.handle = value;
  }
  if (parsed.passwordFile !== undefined && !fs.existsSync(parsed.passwordFile)) {
    throw new Error(`--password-file does not exist: ${parsed.passwordFile}`);
  }
  if (Boolean(parsed.id) === Boolean(parsed.handle)) {
    throw new Error(usage);
  }
  return parsed;
}

/** Pure password-candidate gate (exported for tests). Never logs content. */
export function validatePasswordCandidate(candidate) {
  if (typeof candidate !== "string" || candidate.length < 8) {
    throw new Error("password must be at least 8 characters (matching Settings rules).");
  }
  if (candidate.trim().length === 0) {
    throw new Error("password must not be whitespace only.");
  }
  return true;
}

/** Reads the first line of a password file without echoing or logging it. */
async function readPasswordFile(filePath) {
  const raw = await fsp.readFile(filePath, "utf8");
  return raw.split(/\r?\n/)[0] ?? "";
}

/**
 * Secret prompt with raw mode: keys are captured but never written to the
 * terminal (not even asterisks). Backspace works silently; Enter submits;
 * Ctrl-C aborts. Restores terminal state in finally.
 */
export async function readSecret(promptText) {
  if (!process.stdin.isTTY) {
    throw new Error("stdin is not a TTY; rerun from an interactive terminal or use --password-file.");
  }
  process.stdout.write(promptText);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  let value = "";
  let cancelled = false;
  const onData = (chunk) => {
    for (const ch of chunk) {
      if (ch === "\r" || ch === "\n") {
        cleanup();
        return;
      }
      if (ch === "\u0003") {
        cancelled = true;
        cleanup();
        return;
      }
      if (ch === "\u007f" || ch === "\b") {
        value = value.slice(0, -1);
        continue;
      }
      value += ch;
    }
  };
  const cleanup = () => {
    process.stdin.removeListener("data", onData);
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write("\n");
    resolvePrompt();
  };
  let resolvePrompt;
  await new Promise((resolve) => {
    resolvePrompt = resolve;
    process.stdin.on("data", onData);
  });
  if (cancelled) throw new Error("cancelled by operator");
  return value;
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
  const backupPath = `${DB_PATH}.pre-password-reset-${stamp}`;
  await fsp.copyFile(DB_PATH, backupPath);
  return backupPath;
}

function collectedFrom(store, userId) {
  const user = store.users.find((entry) => entry.id === userId);
  if (!user) throw new Error("target account disappeared from the store.");
  return typeof user.passwordHash === "string" ? user.passwordHash : null;
}

async function main() {
  let parsed;
  try {
    parsed = parseResetArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`ARGUMENT ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
  if (parsed.help) {
    console.log("Usage: npm run reset-legacy-password -- (--id <userId> | --handle <handle>) [--password-file <path>]");
    process.exit(0);
  }

  // 1. Prechecks — nothing may be created before target resolution succeeds.
  const plannedDb = loadStore();
  let target;
  try {
    target = remediation.resolvePasswordResetTarget(plannedDb, { id: parsed.id, handle: parsed.handle });
  } catch (error) {
    console.error(`TARGET ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
  console.log(`target: ${target.id} handle=${target.handle} currentHashLength=${target.previousHashLength ?? "null"}`);

  // 2. Collect the candidate password (never via argv, never echoed).
  let candidate;
  if (parsed.passwordFile !== undefined) {
    try {
      candidate = await readPasswordFile(parsed.passwordFile);
    } catch (error) {
      console.error(`PASSWORD-FILE ERROR: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(2);
    }
    console.log("password read from file (content never displayed).");
  } else {
    try {
      candidate = await readSecret("new password (input hidden): ");
      const confirmation = await readSecret("confirm new password (input hidden): ");
      if (candidate !== confirmation) {
        console.error("CONFIRMATION MISMATCH: entries differ; nothing was changed.");
        process.exit(2);
      }
    } catch (error) {
      console.error(`PROMPT ERROR: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(2);
    }
  }
  try {
    validatePasswordCandidate(candidate);
  } catch (error) {
    console.error(`PASSWORD RULE ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }

  // 3. Mutate the in-memory copy and prove the footprint before touching disk.
  const snapshotBefore = remediation.hashSetSnapshot(plannedDb);
  const newHash = auth.hashPassword(candidate);
  remediation.applyPasswordHash(plannedDb, target.id, newHash);
  const changed = remediation.changedAccounts(snapshotBefore, remediation.hashSetSnapshot(plannedDb));
  if (changed.length !== 1 || changed[0].userId !== target.id || changed[0].direction !== "set") {
    console.error(`FOOTPRINT CHECK FAILED, store NOT rewritten (no backup created): ${JSON.stringify(changed)}`);
    process.exit(3);
  }
  if (!auth.verifyPassword(candidate, collectedFrom(plannedDb, target.id))) {
    console.error("ROUND-TRIP CHECK FAILED, store NOT rewritten (no backup created): verifyPassword rejected the new hash.");
    process.exit(3);
  }

  // 4. Backup, atomic replace, re-read, final verification.
  const serialized = JSON.stringify(plannedDb, null, 2);
  const backupPath = await backupStore();
  console.log(`backup written: ${path.relative(root, backupPath)}`);

  const tmpPath = `${DB_PATH}.tmp-password-reset`;
  await fsp.writeFile(tmpPath, serialized, "utf8");
  const written = JSON.parse(fs.readFileSync(tmpPath, "utf8"));
  const writtenTargetHash = collectedFrom(written, target.id);
  const writtenChanged = remediation.changedAccounts(snapshotBefore, remediation.hashSetSnapshot(written));
  if (
    written.users.length !== plannedDb.users.length ||
    written.sessions.length !== plannedDb.sessions.length ||
    writtenChanged.length !== 1 ||
    writtenChanged[0].userId !== target.id ||
    writtenChanged[0].direction !== "set" ||
    typeof writtenTargetHash !== "string" ||
    !auth.verifyPassword(candidate, writtenTargetHash)
  ) {
    await fsp.unlink(tmpPath);
    console.error("re-read verification FAILED before rename; tmp file removed, original store untouched.");
    process.exit(3);
  }
  await fsp.rename(tmpPath, DB_PATH);

  const finalDb = loadStore();
  const finalHash = collectedFrom(finalDb, target.id);
  const finalChanged = remediation.changedAccounts(snapshotBefore, remediation.hashSetSnapshot(finalDb));
  const finalTargetOk =
    typeof finalHash === "string" && auth.verifyPassword(candidate, finalHash) && finalChanged.length === 1 &&
    finalChanged[0].userId === target.id && finalChanged[0].direction === "set";
  console.log(
    finalTargetOk
      ? `post-write verification: PASS (account ${target.id} handle=${target.handle}; new hash fingerprint ${createHash("sha256").update(finalHash).digest("hex").slice(0, 8)}; all other account hashes unchanged)`
      : "post-write verification: FAILED inspect the backup and the store diff."
  );
  if (!finalTargetOk) process.exit(4);

  console.log("done. Restart any running dev server so in-memory state reloads.");
  if (parsed.passwordFile !== undefined) {
    console.log("reminder: delete the password file you supplied, it still contains the plaintext.");
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  await main();
}
