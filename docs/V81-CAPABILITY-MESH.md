# Atlas V81 — Capability Mesh + Proactive Action Loop

V81 extends the V80 Agent Skills Fabric into a reusable capability boundary and adds the first deterministic layer for proactive operations.

## Capability intersection

An action is executable only when the requested tool is present in all three sets: actor authorization, agent configuration, and assigned skill capability. Skills narrow capability; they never grant authority.

Every evaluation also requires the same tenant ID across actor, agent and skill. A mismatch is rejected before tool execution.

## Connector capability negotiation

Connectors advertise capabilities. Atlas intersects requested capabilities with provider availability and Atlas policy, reporting granted, unsupported and policy-denied capabilities. A degraded connector is therefore explicit instead of guessed.

## Operational Pulse action loop

V80 produces deterministic business risks. V81 maps those risks into proposals, not autonomous side effects:

pulse -> risk -> proposed action -> authorization -> approval -> execution -> audit

This keeps proactive AI useful without turning a diagnostic signal into an implicit write operation.

## Evaluation substrate

The package includes deterministic evaluation scoring. The production layer should persist golden tasks, expected outcomes, tool traces, regression baselines and release gates.

## Next frontier

V82 connector reliability, V83 agent evaluation and observability, V84 durable action operations, V85 visual Business Command Center.
