# V157 P0 — Unified Workflow Node Schema Registry

Date: 2026-10-07
Status: IMPLEMENTED — foundation slice
Scope: graph-time typed node contracts and registry-backed action binding.

## Delivered

packages/atlas-target/workflow-node-schema-registry.mjs adds a single workflow-node contract registry over the existing WORKFLOW_NODE_CATALOG.

The registry exposes:

- bounded contract lookup/listing for the full workflow-node catalog
- schema version and coverage status for each node type
- typed contracts for key foundation nodes including trigger, action, edit-fields, wait/delay, stop and execution-data
- generic catalog-backed contracts for legacy/remaining node types so the registry is total without silently pretending they have strict field schemas
- action-node binding through the existing Atlas action registry
- fail-closed validation for missing or unknown action IDs
- validation that bound actions expose the workflow surface
- validation of the action node input against the bound action's own typed input schema

## Graph integration

packages/atlas-target/index.mjs now accepts optional action/schema registry overrides and validates every normalized workflow node through the unified registry.

The new action workflow node was added to the canonical workflow catalog.

This means a graph can bind:

workflow node -> registered Atlas action -> action input schema

without making the browser or Copilot an authority layer.

The existing ad hoc workflow-node checks remain in place. The registry adds the common contract layer rather than replacing provider-specific guards prematurely.

## TDD coverage

Coverage now verifies:

- the registry covers every catalogued workflow node type
- typed metadata is exposed for foundation nodes
- action binding rejects an unregistered action
- action binding rejects action inputs that violate the bound action schema
- a valid registered action can be embedded in a real createWorkflowGraph() call
- an invalid action node fails graph construction

The earlier V157 P0 typed-action and expression tests remain covered by the same CI test suite.

## Explicit non-goals

This slice does not claim full P0 completion.

Still unfinished:

- strict field schemas for every catalogued legacy node
- connector-specific schemas generated from the connector registry
- output schema propagation between adjacent nodes
- complete graph-to-action mapping for connector_action/provider adapters
- execution-state/error/credential/test-preview parity still tracked in V-series work

## Next implementation frontier

The next highest-priority P0 capability is typed output propagation and execution-state/error contracts across the graph, so each step can validate its resolved input against upstream output shape and expose deterministic failure/retry state to the inspector and replay system.
