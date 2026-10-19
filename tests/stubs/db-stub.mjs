// Same class identity as the real module so `instanceof` checks in server
// code agree with error instances the tests inject.
export { DataStoreUnavailableError } from "../../src/lib/db.ts";

let state = { users: [], sessions: [] };
let readError = null;

export function resetDB(next) {
  state = next;
}

// Test hook: read the current stubbed store (e.g. to prove a destructive
// admin action did NOT run).
export function getDB() {
  return state;
}

// Test hook: make readDB throw (e.g. a DataStoreUnavailableError instance) to
// exercise fail-closed 503 paths. Pass null to restore normal behavior.
export function setReadDBError(next) {
  readError = next;
}

export async function readDB() {
  if (readError) throw readError;
  return state;
}

export async function writeDB(db) {
  state = db;
}

export function serialize(fn) {
  return fn();
}
