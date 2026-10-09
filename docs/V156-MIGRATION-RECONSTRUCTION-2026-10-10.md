# V156 migration reconstruction — 2026-10-10

## Finding

GitHub Actions on the prior Atlas branch failed before several database-backed suites could run. The shared error was a PostgreSQL parser failure in `infra/postgres/FINAL-MIGRATION-V156.sql`: a table definition was cut off mid-check constraint, and several copies of the RLS/function/COMMIT tail had been spliced into the file. This prevented all migration consumers from initializing their test database.

## Change

- Reconstructed the quote and payment-link table definitions from the intact schema fragments.
- Restored one ordered RLS/policy/grant block covering the 23 V156 tenant-scoped tables.
- Restored one idempotent provider-event reconciliation function and its restricted worker grant.
- Removed duplicated/truncated SQL fragments and retained one enclosing transaction.

## Verification

The existing migration-backed tests automatically apply the full ordered migration set and are the authoritative regression check. GitHub Actions must complete on this branch before this change is considered verified. The migration remains staged; no production database has been migrated by this change.
