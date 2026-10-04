# V116 Workflow Studio

## Implemented

- Authenticated workspace authoring for workflow names, the canonical Atlas trigger catalog, node types, bounded node settings, and directed connections/ports.
- A read-only API endpoint at `GET /api/v1/growth/workflows/catalog`. It resolves the active session and delegates to the same tenant membership and `workflows.read` permission gate used by workflow records.
- Draft creation and revision saves continue through the existing strict Growth Center validators, immutable version history, audit events, and tenant RLS. Invalid graph definitions now return a 400 validation error rather than an internal server error.
- Approval-required nodes show their server policy; connector nodes identify their adapter dependency. Graph save/publish does not enqueue work.

## Not implemented by this release

The V115 worker has no bundled workflow handler or graph interpreter. There is no live trigger ingestion, execution history, retry/replay control, delayed resume, approval resume, connection vault, model/provider adapter, or external message delivery. The Studio explicitly tells users that workflow jobs are not connected. A definition marked published is a published, checksummed configuration only; it does not mean that workflow automation is running.

## Checks

API tests verify active-tenant scoping, unauthenticated denial, and read-only catalog access. Existing graph contract tests cover supported triggers and nodes, graph reachability, cycle rejection, bounded settings, approval evidence, and tenant binding. The V116 HTTP smoke test verifies that the Studio JavaScript asset is served by the authenticated API host.

The product remains dependent on configured PostgreSQL migrations and runtime grants. Real execution needs separately reviewed handlers and isolated tenant-safe runtime access before any provider side effect can be enabled.
