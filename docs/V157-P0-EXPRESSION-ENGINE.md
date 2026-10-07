# V157 P0 — Declarative Expression Engine

Date: 2026-10-07
Status: **IMPLEMENTED — foundation slice**
Scope: safe expressions for workflow data mapping and typed action input resolution.

## Delivered

packages/atlas-core/expression-engine.mjs provides a deterministic, read-only expression evaluator with:

- allowlisted roots: input, trigger, steps, contact, lead, deal, appointment, conversation and workflow
- reserved-field rejection for credential/security-sensitive names
- string, number, integer, boolean, null and array/object value handling
- arithmetic, comparisons and boolean operators
- bounded allowlisted functions: string, number, boolean, trim, lowercase, uppercase, join, coalesce, exists and length
- optional {{ expression }} wrappers
- strict expression length, node-count, nesting and result-size budgets
- explicit errors for invalid syntax, unavailable paths, type mismatches and unsafe arithmetic
- syntax-only compilation so validation does not require live data

The evaluator has no network, shell, dynamic code loading, assignment or external side effects.

## Existing Atlas integration

The existing safe-data-mapping contract now accepts exactly one of:

- an allowlisted source path plus an existing transform
- a declarative expression plus the existing identity transform

The existing edit-fields workflow node therefore evaluates declarative expressions without creating a new execution engine.

Typed action inputs can also use an object of the form:
{ "$expression": "input.customer.score" }

createInvocation() resolves those wrappers against a supplied expression context before the existing credential-input checks, schema validation and provider/consent/approval gates.

## TDD coverage

The expression tests cover:

- lowercase transformation from a typed input path
- numeric arithmetic
- boolean comparisons
- bounded array joining
- {{ ... }} expression wrappers
- expression-backed edit-fields mappings
- syntax acceptance through compileExpression()
- rejection of non-allowlisted roots and functions
- fail-closed missing-path evaluation

The action-fabric tests additionally cover expression-bound input resolution into a typed action schema.

## Security boundary

Expressions are data selectors, not executable code. The parser recognizes only its bounded grammar and allowlisted functions. Context is read-only, paths are root- and field-allowlisted, sensitive field names are rejected, and results are size-bounded.

Expression evaluation does not weaken tenant authorization, credential isolation, live-provider verification, consent, approvals, quotas or audit behavior.

## Explicit non-goals

This does not claim full V157 P0 completion.

Still unfinished:

- typed schemas for every workflow node definition
- complete graph-to-action binding enforcement
- field-level expression metadata across every node catalog entry
- remaining execution, error, credential and test/preview parity work tracked by the V-series roadmap

## Next implementation frontier

The next highest-priority P0 capability is the **unified workflow-node schema registry and graph-to-action binding layer**, so every catalogued node has a first-class typed input/output contract and the same action registry can be consumed by workflow, API, MCP and agent surfaces.
