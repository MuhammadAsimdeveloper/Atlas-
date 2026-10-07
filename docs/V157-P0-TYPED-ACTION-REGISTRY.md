# V157 P0 — Typed Action Registry and Schema Enforcement

Date: 2026-10-07
Status: **IMPLEMENTED — foundation slice**
Scope: shared action contracts used by API, workflow, MCP, agent, UI, portal and webhook surfaces.

## Why this slice was highest priority

The V157 parity plan requires node/action capabilities to be registry-backed and schema-validated. Atlas already had an action catalog and input-schema metadata, but invocation did not enforce those schemas, and custom defineAction() results could not be used through a registry-scoped invocation.

That made the contract descriptive rather than executable.

## Delivered

### Bounded schema contract

packages/atlas-action-fabric/schema.mjs now provides a deliberately bounded JSON-schema subset:

- object, string, number, integer, boolean and array types
- required properties
- nested properties and array items
- enum constraints
- length, item-count and numeric bounds
- explicit additionalProperties handling
- safe depth/size limits
- rejection of unsupported schema keywords
- fail-closed schema_validation_failed errors with field paths

Schema objects are normalized and frozen before entering an action definition.

### Action registry

packages/atlas-action-fabric/index.mjs now provides createActionRegistry() with:

- bounded immutable action registration
- duplicate-ID rejection
- action lookup and filtered listing
- schema-aware input validation
- deterministic action definition hashes

getAction() and listActions() use the default registry, while createInvocation() accepts an explicit registry for tenant/application-specific action sets.

### Invocation enforcement

Every action invocation now runs:

1. existing bounded/security input checks
2. action registry resolution
3. typed input-schema validation
4. existing provider, consent and approval gates for live side effects

Schema validation therefore cannot bypass the existing safety boundary; it adds a typed contract before execution.

## TDD evidence

The RED test was committed before implementation and CI failed during npm test, proving the old runtime could not satisfy the new contract.

Implementation then exposed a deterministic-definition-hash ordering defect during validation; that was corrected before considering the slice complete.

Primary coverage is in:
packages/atlas-action-fabric/index.test.mjs

The relevant test verifies that:

- a registry can resolve a newly defined typed action
- invalid field types fail closed
- required fields fail closed
- a valid typed payload produces an invocation

## Explicit non-goals

This slice does not claim that the entire V157 P0 is complete.

Still unfinished in the P0 foundation are:

- a unified typed schema registry for every workflow node type
- a first-class expression engine and field mapper
- deeper graph-to-action binding enforcement
- the remaining execution/error/credential parity work already tracked by the V-series roadmap

External provider credentials and production integrations remain governed by their existing NOT_CONFIGURED/BLOCKED/UNVERIFIED gates.

## Next implementation frontier

The next highest-priority P0 capability is the declarative expression/data-mapping engine, shared by workflow nodes and action inputs, with bounded paths, typed values, deterministic evaluation and preview-safe fixtures.

That work should extend the existing safe-data-mapping and workflow runtime contracts rather than creating a second automation engine.
