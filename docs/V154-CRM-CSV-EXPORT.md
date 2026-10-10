# V154 — CRM CSV Export Safety Slice

## Scope delivered

This slice adds `createCsvExportPlan` to the existing customer-lifecycle domain module.

- Requires the export tenant to match the schema tenant.
- Allows only schema-declared fields and rejects duplicate/empty field selections.
- Validates every row against the schema before generating output.
- Uses RFC-style quoted CSV cells, doubles embedded quotes, and emits CRLF row endings.
- Prefixes potentially executable spreadsheet formula text with an apostrophe.
- Produces a deterministic SHA-256 artifact hash and explicit CSV content type.
- Adds regression tests for formula injection, escaping, invalid rows, invalid fields, and tenant mismatch.

## Trust boundary

This is a pure formatting/validation primitive, not an authenticated export endpoint. The API must authorize the actor, query records with tenant-scoped persistence/RLS, apply export permissions and PII policy, and audit the export before invoking it. A caller-supplied tenant ID is not authorization evidence. Large exports should later move to bounded streaming/object storage rather than returning a large in-memory string.

## Verification status

- Regression tests added in `packages/atlas-customer-lifecycle/index.test.mjs`.
- CI and local Node test execution have not been run from this GitHub editing session; merge only after repository CI passes.
- This does not complete GHL CRM parity: CSV import/API wiring, saved views, bulk operations, merge approval, custom-object API integration, and the full activity timeline remain open.
