/**
 * Audit P0-2 regression: `data/db.json` (the legacy store) must never be
 * tracked in Git again. It carried live session tokens, password hashes, and
 * private messages into HEAD/origin. The file was untracked from the index
 * (staged deletion, working copy preserved) and ignored.
 *
 * These assertions run Git plumbing commands against the LOCAL repository.
 * They intentionally do NOT assert that HEAD is already clean — a history
 * rewrite is approval-gated — only that NO NEW change can re-track the file
 * from the working tree.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

function git(args: string[], allowEmptyStdout = false): string {
  try {
    return execFileSync("git", args, { encoding: "utf8", cwd: process.cwd() });
  } catch (error) {
    const err = error as { stdout?: string; status?: number };
    // `git check-ignore` exits 1 when path is NOT ignored; 0 when it is.
    if (allowEmptyStdout && typeof err.status === "number") return err.stdout ?? "";
    throw error;
  }
}

function gitStatus(args: string[]): { ok: boolean; status?: number } {
  try {
    execFileSync("git", args, { encoding: "utf8", cwd: process.cwd() });
    return { ok: true };
  } catch (error) {
    return { ok: false, status: (error as { status?: number }).status };
  }
}

test("data/db.json is covered by .gitignore", () => {
  const check = gitStatus(["check-ignore", "-q", "data/db.json"]);
  assert.equal(check.ok, true, "git check-ignore must match data/db.json");
});

test("data/db.json is not in the index (cannot get committed again)", () => {
  const listed = git(["ls-files", "data/db.json"], true);
  assert.equal(listed.trim(), "", "git ls-files must not list data/db.json");
});

test("no tracked file (working tree) contains Motion session-token or scrypt hash shapes", () => {
  // Scans TRACKED files only (git grep without a revision). data/db.json is
  // untracked, and any future re-introduction of credentials into a tracked
  // file (e.g. a seeded fixture with real values) is a red flag.
  let listed = "";
  try {
    listed = git(["grep", "-I", "-l", "-E", "s_[a-f0-9]{20}|[0-9a-f]{32}:[0-9a-f]{64}", "--", "."], true);
  } catch {
    listed = "";
  }
  const offenders = listed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  assert.deepEqual(
    offenders,
    [],
    `credential-shaped strings found in tracked files: ${offenders.join(", ")}`
  );
});
