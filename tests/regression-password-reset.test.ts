/**
 * P0-2 operator-assisted password reset regression (synthetic data only):
 *
 * Real account identifiers, real passwords, and real hash values NEVER
 * appear in this file. Every account id, handle, and password here is an
 * obvious synthetic fixture. These tests prove:
 *   1. resolvePasswordResetTarget hits exactly one account by id or handle
 *      and aborts on zero matches or ambiguity.
 * 2. hash snapshot → apply → diff yields exactly one "set" (or one
 *      "cleared"), and an untouched store diffs to empty.
 * 3. the application hash functions round-trip through the new primitives
 *      (right password verifies, wrong password fails).
 * 4. the reset SCRIPT's pure arg parsing rejects insecure usage (secrets
 *      via argv, missing values, double/missing targets, missing file),
 *      and its source keeps the backup / atomic-replace / round-trip
 *      wiring in place.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

Object.assign(process.env, { NODE_ENV: "test" });

import {
  resolvePasswordResetTarget,
  hashSetSnapshot,
  applyPasswordHash,
  changedAccounts,
} from "@/lib/credential-remediation";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { parseResetArgs, validatePasswordCandidate } from "../scripts/set-legacy-password.mjs";

const SYNTHETIC_HASH_OTHER = hashPassword("synthetic-other-password");
const SYNTHETIC_PASSWORD = "synthetic-new-password";
const SYNTHETIC_PASSWORD_WRONG = "synthetic-wrong-password";

function resetFixture() {
  return {
    users: [
      { id: "u_syn_target", handle: "synthetic_target", passwordHash: hashPassword(SYNTHETIC_PASSWORD) },
      { id: "u_syn_plain", handle: "synthetic_plain", passwordHash: null },
      { id: "u_syn_other", handle: "synthetic_other", passwordHash: SYNTHETIC_HASH_OTHER },
    ],
    sessions: [],
  };
}

test("resolvePasswordResetTarget hits exactly one account by id", () => {
  const db = resetFixture();
  const target = resolvePasswordResetTarget(db, { id: "u_syn_target" });
  assert.equal(target.id, "u_syn_target");
  assert.equal(target.handle, "synthetic_target");
  assert.equal(target.previousHashLength, 97); // 32-char salt + colon + 64-char hash
});

test("resolvePasswordResetTarget hits exactly one account by handle", () => {
  const db = resetFixture();
  const target = resolvePasswordResetTarget(db, { handle: "synthetic_other" });
  assert.equal(target.id, "u_syn_other");
  assert.equal(target.previousHashLength, 97);
});

test("resolvePasswordResetTarget aborts on zero matches", () => {
  const db = resetFixture();
  assert.throws(() => resolvePasswordResetTarget(db, { handle: "nobody_here" }), /no account matches/);
});

test("resolvePasswordResetTarget aborts on ambiguous handle", () => {
  const db = resetFixture();
  db.users.push({ id: "u_syn_dupe", handle: "synthetic_target", passwordHash: null });
  assert.throws(() => resolvePasswordResetTarget(db, { handle: "synthetic_target" }), /ambiguous/);
});

test("snapshot + apply + diff yields exactly one set on the target only", () => {
  const db = resetFixture();
  const before = hashSetSnapshot(db);
  const newHash = hashPassword(SYNTHETIC_PASSWORD);
  applyPasswordHash(db, "u_syn_plain", newHash);
  const changed = changedAccounts(before, hashSetSnapshot(db));
  assert.deepEqual(changed, [{ userId: "u_syn_plain", direction: "set" }]);
  // untouched accounts keep byte-equal hashes
  assert.equal(db.users[0].passwordHash, before.get("u_syn_target"));
  assert.equal(db.users[2].passwordHash, SYNTHETIC_HASH_OTHER);
});

test("diff is empty when nothing changed; cleared direction detected", () => {
  const db = resetFixture();
  const before = hashSetSnapshot(db);
  assert.deepEqual(changedAccounts(before, hashSetSnapshot(db)), []);
  applyPasswordHash(db, "u_syn_target", null);
  assert.deepEqual(changedAccounts(before, hashSetSnapshot(db)), [
    { userId: "u_syn_target", direction: "cleared" },
  ]);
});

test("new hash round-trips through the application verify functions", () => {
  const db = resetFixture();
  const before = hashSetSnapshot(db);
  const newHash = hashPassword(SYNTHETIC_PASSWORD);
  applyPasswordHash(db, "u_syn_target", newHash);
  const after = hashSetSnapshot(db);
  assert.deepEqual(changedAccounts(before, after), [{ userId: "u_syn_target", direction: "set" }]);
  assert.equal(verifyPassword(SYNTHETIC_PASSWORD, after.get("u_syn_target")!), true);
  assert.equal(verifyPassword(SYNTHETIC_PASSWORD_WRONG, after.get("u_syn_target")!), false);
  // per-user salt: the same password must produce a different stored value
  assert.notEqual(newHash, before.get("u_syn_target"));
});

test("reset script arg parsing rejects insecure usage", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "reset-args-"));
  const validFile = path.join(dir, "candidate.txt");
  writeFileSync(validFile, "synthetic-file-password", "utf8");
  // exactly one target required
  assert.throws(() => parseResetArgs([]), /usage|exactly/);
  assert.throws(() => parseResetArgs(["--id", "a", "--handle", "b"]), /usage|exactly/);
  // unknown flags and missing values
  assert.throws(() => parseResetArgs(["--password", "never-accept-secrets-via-argv"]), /unknown argument/);
  assert.throws(() => parseResetArgs(["--id"]), /missing value/);
  assert.throws(() => parseResetArgs(["--handle", "--password-file"]), /missing value/);
  // missing password file
  assert.throws(() => parseResetArgs(["--id", "a", "--password-file", path.join(dir, "nope.txt")]), /does not exist/);
  // the only accepted shape
  const parsed = parseResetArgs(["--handle", "synthetic_target", "--password-file", validFile]);
  assert.equal(parsed.handle, "synthetic_target");
  assert.equal(parsed.passwordFile, validFile);
});

test("reset script password-candidate gate enforces the Settings rules", () => {
  assert.throws(() => validatePasswordCandidate("short7x"), /at least 8/);
  assert.throws(() => validatePasswordCandidate("            "), /whitespace only/);
  assert.throws(() => validatePasswordCandidate(undefined), /at least 8/);
  assert.equal(validatePasswordCandidate("synthetic-new-password"), true);
  // no normalization: surrounding whitespace stays part of the password
  assert.equal(validatePasswordCandidate(" padded-passphrase-9 "), true);
});

test("reset script keeps its structural safety wiring (backup, atomic replace, round-trip)", () => {
  const source = readFileSync("scripts/set-legacy-password.mjs", "utf8");
  assert.match(source, /pre-password-reset-/);
  assert.match(source, /tmp-password-reset/);
  assert.match(source, /rename\(/);
  assert.match(source, /verifyPassword\(/);
  assert.match(source, /collectRemediationPlan|resolvePasswordResetTarget/);
  // the script must never splice a password into argv or log the candidate
  assert.doesNotMatch(source, /process\.exit\(0\)[\s\S]{0,80}password\s*[,)]/);
});
