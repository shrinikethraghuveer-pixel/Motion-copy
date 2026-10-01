# Institution directory import

`public.institutions` is currently empty. Do not add ad-hoc rows or institution
names to React. Populate it through a vetted source extract and the server-only
importer instead.

## Recommended sources

- **Higher education:** AISHE's Higher Education Institution Directory is the
  primary authoritative source for universities, colleges, standalone and
  national institutes. Capture the extract date and the provider's stable ID
  before import.
- **Schools:** UDISE+ is the authoritative directory. Its raw microdata portal
  requires registration/data-request approval; use an approved extract rather
  than aggregated public reports.

The public OGD AISHE catalog is useful for historical reconciliation but is not
current enough to be the sole production directory. Keep source files out of
git unless their licence expressly permits redistribution.

## Canonical staging CSV

Create a reviewed UTF-8 CSV with the following headers:

```csv
external_id,name,institution_type,city,state,country,country_code,aliases,website
```

`external_id` must be the source's stable identifier. `aliases` is either a
JSON array or a `|`-separated list, and only contains source-verified alternate
names/acronyms. Do not use a shared acronym such as `BMS` as an alias for one
institution when it can refer to several.

## Import workflow

1. Obtain and retain the source extract and its licence/provenance record.
2. Transform source-specific columns into the canonical staging CSV.
3. Run a dry run:

   ```sh
   node scripts/import-institutions.mjs data/institutions/aishe.csv --source aishe-2023-24
   ```

4. Review duplicate source IDs, blank locations, aliases, and an institution
   sample for each target city/type.
5. With a server-only `SUPABASE_SERVICE_ROLE_KEY` available in the shell, run
   the same command with `--apply`.
6. Verify row counts, active records, and the existing `search_institutions`
   RPC for abbreviation, punctuation, and full-name queries.

The importer stores a normalized canonical name. It folds case/diacritics and
normalizes runs of one-letter tokens, so `B.M.S`, `B M S`, and `BMS` produce
the same normalized form. The search RPC must apply equivalent normalization
to its query and search `name`, `normalized_name`, and `aliases` before this
behavior can be relied on.
