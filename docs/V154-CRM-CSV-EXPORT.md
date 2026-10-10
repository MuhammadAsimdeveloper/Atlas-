# V154 — CRM CSV Import/Export Safety Slice

## Scope delivered

The customer-lifecycle module now exposes bounded CSV import and export primitives.

- `createCsvExportPlan` requires tenant/schema consistency, allows only schema-declared fields, validates every record, escapes CSV quotes, emits CRLF rows, protects formula-leading text (including leading whitespace and tab), and returns a deterministic artifact hash.
- `parseCsvImport` handles a UTF-8 BOM, quoted cells, escaped quotes, commas inside quotes, CRLF/LF rows, and embedded newlines inside quoted cells.
- CSV import has configurable byte and row limits, unique schema-field header allowlisting, strict column counts, tenant/schema checks, and field-type coercion for numbers and booleans.
- `createCsvImportPlan` is dry-run only and returns validated/invalid row counts and a deterministic plan hash. It does not persist or mutate CRM records.
- Regression tests cover quoting, formula injection, CRLF, invalid headers, malformed quotes, tenant mismatch, limits, and dry-run validation.

## Trust boundary

These are pure domain primitives, not authenticated endpoints. API callers must authorize the actor, query records with tenant-scoped persistence/RLS, enforce export/import permissions and PII policy, and append an audit event. A caller-supplied tenant ID is not authorization evidence. Import commit must be a separate idempotent command with duplicate policy, optimistic concurrency, audit history and rollback/recovery behavior. Large exports should use bounded streaming/object storage.

## Verification status

- Regression tests have been added, but the full suite has not yet passed on this branch.
- The initial PR CI run failed 20 tests. Eight PostgreSQL-related tests were blocked by a syntax error in the existing `infra/postgres/FINAL-MIGRATION-V156.sql`; other failures included pre-existing customer-lifecycle and transactional tests. The log must be reviewed against a fresh CI run before merge.
- This is not full GHL CRM parity: authenticated API/UI wiring, persistent import commit, saved views, bulk operations, merge approval, custom-object API integration, and the full activity timeline remain open.
