# Platform Admin Phase 2 — Moderation and Notification Read Surfaces

Date: 2026-10-10

## Delivered on `fix/v156-migration-corruption`

- Added additive PostgreSQL migration `FINAL-MIGRATION-V157.sql` with moderation reports, append-only moderation event schema, platform notification records and delivery attempt history.
- Added narrow SECURITY DEFINER read functions with fixed search paths. Direct table grants are not given to the API role; the functions clamp list sizes and return only the queue data.
- Added owner-authorized API reads for `/api/v1/platform-admin/content` and `/api/v1/platform-admin/notifications`, with allow-listed status filters and bounded limits.
- Replaced placeholder admin screens with queue tables showing status, timestamps, workspace association, reasons, attempts and error state.
- Added API tests for function-based reads and invalid status rejection.
- Financial views remain fail-closed. User account mutations, content decisions, notification sending/retries and bulk actions remain disabled.

## Safety decisions

- The moderation tables keep a distinct event trail schema; moderation decision actions are not yet enabled because no adapter currently guarantees that hiding/restoring/suspending the underlying content and writing its audit event happen in one transaction.
- Notification records are operational metadata only. No delivery is claimed: the provider dispatch worker, recipient-level delivery ledger, suppression/consent checks, bounce handling and idempotent retry loop are not yet connected.
- RLS is enabled for the new platform tables and no tenant-facing policies or direct table grants are created. Read access is exposed through owner-executed SECURITY DEFINER functions, with execution granted only to `atlas_app`.
- Migration has been committed to the development branch; this is not evidence it has been applied to production.

## Verification

The API tests were extended. GitHub Actions must pass for the current branch head before treating this phase as CI-verified. The next phase is audited transactional moderation decisions, then the provider-backed notification queue and delivery worker, followed by launch/security gates.
