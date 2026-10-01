#!/usr/bin/env node

/**
 * Imports a vetted canonical institution CSV into Supabase.
 *
 * This command is deliberately dry-run by default. `--apply` requires a
 * server-only service-role key and is never suitable for browser execution.
 * See docs/institutions-import.md for the canonical CSV contract.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const REQUIRED_COLUMNS = ["external_id", "name"];
const OPTIONAL_COLUMNS = ["institution_type", "city", "state", "country", "country_code", "aliases", "website"];

function usage(message) {
  if (message) console.error(`Error: ${message}\n`);
  console.error("Usage: node scripts/import-institutions.mjs <canonical.csv> --source <source-name> [--apply]");
  process.exitCode = 1;
}

/** Keep letters/numbers, fold accents, and collapse acronym punctuation/spaces. */
export function normalizeInstitutionName(value) {
  const tokens = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  // Treat B.M.S, B M S, and BMS alike without joining ordinary word initials.
  const normalized = [];
  for (let index = 0; index < tokens.length;) {
    if (tokens[index].length !== 1) {
      normalized.push(tokens[index++]);
      continue;
    }
    let end = index;
    while (end < tokens.length && tokens[end].length === 1) end++;
    normalized.push(tokens.slice(index, end).join(""));
    index = end;
  }
  return normalized.join(" ");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (quoted) throw new Error("CSV has an unterminated quoted value.");
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows.filter((cells) => cells.some((cell) => cell.trim()));
}

function aliasesFrom(value, name) {
  const raw = String(value ?? "").trim();
  const candidates = raw ? (raw.startsWith("[") ? JSON.parse(raw) : raw.split("|")) : [];
  const seen = new Set([normalizeInstitutionName(name)]);
  return candidates
    .map((alias) => String(alias).trim())
    .filter((alias) => alias && !seen.has(normalizeInstitutionName(alias)))
    .filter((alias) => (seen.add(normalizeInstitutionName(alias)), true));
}

function toRows(csv, source) {
  const [headers, ...records] = parseCsv(csv);
  if (!headers) throw new Error("CSV is empty.");
  const columns = headers.map((header) => header.trim().toLowerCase());
  for (const column of REQUIRED_COLUMNS) if (!columns.includes(column)) throw new Error(`Missing required '${column}' column.`);
  return records.map((record, offset) => {
    const input = Object.fromEntries(columns.map((column, index) => [column, (record[index] ?? "").trim()]));
    if (!input.external_id || !input.name) throw new Error(`Row ${offset + 2} needs external_id and name.`);
    const normalized_name = normalizeInstitutionName(input.name);
    if (!normalized_name) throw new Error(`Row ${offset + 2} has an unusable name.`);
    return {
      name: input.name,
      normalized_name,
      institution_type: input.institution_type || null,
      city: input.city || null,
      state: input.state || null,
      country: input.country || "India",
      country_code: input.country_code || "IN",
      aliases: aliasesFrom(input.aliases, input.name),
      website: input.website || null,
      source,
      external_id: input.external_id,
      is_active: true,
    };
  });
}

function readArguments(args) {
  const [file, ...rest] = args;
  const sourceIndex = rest.indexOf("--source");
  return { file, source: sourceIndex >= 0 ? rest[sourceIndex + 1] : undefined, apply: rest.includes("--apply") };
}

async function fetchExistingByExternalId(supabase) {
  const existing = new Map();
  const pageSize = 1000;
  for (let offset = 0;; offset += pageSize) {
    const { data, error } = await supabase
      .from("institutions")
      .select("id, external_id")
      .not("external_id", "is", null)
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    for (const row of data) if (!existing.has(row.external_id)) existing.set(row.external_id, row.id);
    if (data.length < pageSize) return existing;
  }
}

async function writeInBatches(supabase, operation, rows) {
  const batchSize = 200;
  let written = 0;
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const { data, error } = await operation(batch);
    if (error) throw error;
    written += data?.length ?? batch.length;
  }
  return written;
}

async function main() {
  const { file, source, apply } = readArguments(process.argv.slice(2));
  if (!file || !source || source.startsWith("--")) return usage("a CSV path and --source are required.");
  const rows = toRows(await readFile(resolve(file), "utf8"), source);
  const unique = new Set();
  for (const row of rows) {
    if (unique.has(row.external_id)) throw new Error(`Duplicate external_id: ${row.external_id}`);
    unique.add(row.external_id);
  }
  console.log(`Validated ${rows.length} institution records from ${source}.`);
  if (!apply) return console.log("Dry run only. Review the source and rerun with --apply to write.");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("--apply requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  // Reconcile by the source's stable ID without assuming an external_id
  // uniqueness constraint exists in the target database.
  const existingByExternalId = await fetchExistingByExternalId(supabase);
  const inserts = [];
  const updates = [];
  for (const row of rows) {
    const id = existingByExternalId.get(row.external_id);
    if (id) updates.push({ ...row, id });
    else inserts.push(row);
  }

  const inserted = await writeInBatches(supabase, (batch) =>
    supabase.from("institutions").insert(batch).select("id"), inserts);
  const updated = await writeInBatches(supabase, (batch) =>
    supabase.from("institutions").upsert(batch, { onConflict: "id" }).select("id"), updates);
  console.log(`Imported ${inserted} institution records; updated ${updated} existing records.`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
