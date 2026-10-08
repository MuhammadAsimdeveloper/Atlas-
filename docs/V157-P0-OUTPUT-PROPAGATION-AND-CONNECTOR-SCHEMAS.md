# V157 P0 — Output Propagation and Connector Schemas

Date: 2026-10-08
Status: IMPLEMENTED — foundation slice

## Scope

This slice closes the next P0 gap identified in docs/AI_BUILD_START_HERE.md: connector-derived typed schemas and automatic output-shape propagation across the existing workflow graph.

No second execution engine is introduced.

## Delivered

### Connector schema registry

packages/atlas-integration-fabric/index.mjs now exposes createConnectorSchemaRegistry().

The registry:

- accepts only valid, checksummed tenant connector definitions;
- normalizes operation input/output schemas through the existing bounded JSON-schema contract;
- resolves an operation by tenant, connector reference and operation reference;
- fails closed on cross-tenant lookup and ungranted operations;
- reports typed versus generic schema coverage without exposing credential material.

Connector operation schemas are now part of the connector definition contract rather than ad hoc metadata.

### Workflow connector binding

packages/atlas-target/workflow-node-schema-registry.mjs adds a typed connector_action contract.

A connector action requires connectorRef, connectionRef and operationRef, with optional input validated against the selected operation input schema. The selected operation's output schema becomes the node's runtime output contract.

### Automatic graph propagation

createWorkflowGraph() now runs the existing registry across the validated DAG and persists runtimeInputSchema, outputSchema, propagatedInputSchema, upstream node references, upstream output schema references and a deterministic schema fingerprint.

For a single upstream node, a generic downstream runtime input inherits the upstream output shape. For strict downstream inputs, graph construction performs structural compatibility checks and fails closed on required-field/type conflicts.

For multiple upstream nodes, the merge is conservative: only common required fields and non-conflicting property schemas are retained.

validateWorkflowNodeInput() validates an actual runtime payload against the propagated input schema.

## TDD coverage

Tests were added before the implementation commits for tenant-scoped connector operation schema lookup, typed connector input/output normalization, cross-tenant and unknown-operation rejection, connector output propagation into a downstream typed action, runtime downstream-input validation, and incompatible upstream/downstream schemas failing graph construction.

## Security boundary

Connector schemas contain contract metadata only. Credential bytes remain outside workflow definitions.

Schema propagation never grants permissions, selects credentials, bypasses approval, or marks an external provider verified. It only determines whether data shapes are contractually compatible.

Generic upstream output is treated as unknown rather than as proof that a strict downstream contract will be satisfied.

## Execution-time validation extension

The worker now forwards resolved provider output into the pinned execution contract. Typed node outputs are validated before completion, and the durable step stores only a deterministic `outputHash` plus `outputSchemaVersion`; raw provider output is never persisted in execution state. Resolved reconciliation is also idempotent for an already-resolved identical decision.

## Connector runtime extension

`apps/worker/provider-runtime.mjs` now supports `connector_action` through the same tenant-scoped connector registry. A worker execution must resolve the registered operation, re-check a verified same-tenant provider connection, require the connection's provider identity to match the connector reference, verify required operation scopes, resolve `credential_ref` through the explicit external secret resolver, compose a same-origin URL, apply only supported authentication modes, validate the outbound input and inbound output against the registered schemas, and attach a stable idempotency key for idempotent operations. Raw credentials and provider response bodies are not persisted in execution state.

Unsupported authentication/adapter modes fail closed rather than silently degrading to a generic network call.

## Remaining P0

The remaining foundation gaps are strict schemas for all legacy node definitions; full connector authorization coverage for every auth mode and provider adapter; durable reconciliation worker/queue integration; credential lifecycle and external secret-store hardening; and test/preview and execution-inspector parity.

External provider activation and production infrastructure remain explicit deployment gates.

## Credential lifecycle extension

The V122 credential table now has an authenticated tenant-scoped API layer for metadata lifecycle management:

- credential creation stores only an external secret_ref;
- list/get responses return secret_ref_present but never the vault pointer itself;
- rotation replaces the external reference and resets the credential to active;
- revoked credentials cannot be rotated in place;
- revoke is idempotent;
- expiry input is validated at the API/store boundary.

The live worker continues to resolve secret material only through the explicit external secretResolver boundary. Credential lifecycle storage never places plaintext credentials in workflow definitions, queue payloads or execution state.

Authenticated routes:

- GET /api/v1/growth/credentials
- POST /api/v1/growth/credentials
- POST /api/v1/growth/credentials/:credentialId/rotate
- POST /api/v1/growth/credentials/:credentialId/revoke

## Legacy-node schema extension

The workflow-node schema registry now marks a broad legacy cluster as typed instead of catalog-generic. It derives strict object schemas for reference-bearing CRM, booking, communication, integration, AI, timing, branching, batching and error/control nodes from the existing compiler semantics. Unknown config keys are rejected at graph build time, while older catalog entries not yet covered by a strict schema remain explicitly generic rather than being falsely advertised as complete.
