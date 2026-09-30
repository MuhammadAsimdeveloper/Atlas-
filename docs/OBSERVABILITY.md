# Atlas Observability Contract

Atlas follows OpenTelemetry semantic conventions for consistent telemetry names and attributes.

## Required context

Every agent/tool/provider operation should carry:

- tenant.id
- agent.id
- skill.id
- action.id
- connector.id
- operation.name
- error.type on failures

Do not put customer message bodies, secrets, access tokens or arbitrary payloads into span attributes.

## Suggested spans

- atlas.agent.run
- atlas.skill.execute
- atlas.tool.call
- atlas.connector.request
- atlas.action.execute

## Suggested metrics

- atlas.agent.evaluation.score
- atlas.agent.run.duration
- atlas.connector.request.duration
- atlas.connector.request.errors
- atlas.connector.capability.drift
- atlas.action.pending
- atlas.action.execution.errors

Durations use seconds at the telemetry boundary, consistent with OpenTelemetry metric guidance.

## Events

Use events for action approval, cancellation, capability drift and evaluation release-gate decisions. Keep events structured and low-cardinality.

The repository's createTelemetryFacade() accepts injected tracer/meter objects. This keeps domain tests deterministic while allowing a deployed service to initialize the OpenTelemetry SDK before application modules load.