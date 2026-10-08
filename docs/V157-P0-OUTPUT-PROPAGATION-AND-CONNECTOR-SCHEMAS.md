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

## Remaining P0

The remaining foundation gaps are strict schemas for all legacy node definitions; execution-time validation of actual provider result payloads in workers; complete connector action/provider-operation authorization and credential resolution; durable reconciliation worker/queue integration; credential lifecycle and external secret-store hardening; and test/preview and execution-inspector parity.

External provider activation and production infrastructure remain explicit deployment gates.
