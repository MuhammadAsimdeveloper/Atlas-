# Atlas Observability Contract

Atlas follows OpenTelemetry semantic conventions and keeps domain telemetry transport-neutral.

## Required context
Every agent/tool/provider/queue operation should carry tenant.id, operation.name and stable agent.id, skill.id, action.id, job.id or connector.id when applicable. Record error.type on failures.

Never place customer message bodies, secrets, access tokens or arbitrary payloads into span attributes.

## Suggested spans
- atlas.agent.run
- atlas.skill.execute
- atlas.tool.call
- atlas.connector.request
- atlas.sync.run
- atlas.queue.lease
- atlas.action.execute
- atlas.graph.project
- atlas.revenue.snapshot

## Suggested metrics
- atlas.agent.evaluation.score
- atlas.agent.run.duration
- atlas.connector.request.duration
- atlas.connector.request.errors
- atlas.connector.capability.drift
- atlas.sync.lag
- atlas.queue.depth
- atlas.queue.execution.errors
- atlas.action.pending
- atlas.action.execution.errors
- atlas.slo.burn_rate

## SLO model
Good events divided by total events gives the availability ratio. Error budget is 1 - target. Burn rate is consumed error budget divided by the allowed error budget. Deployment-specific alert thresholds and ownership remain outside the domain package.

The repository supplies deterministic OTLP request and SLO helpers; production should inject an authenticated exporter and collector.

## Durable execution context
Stable action.id, job.id and connector.id references let operators follow work across retries, leases, worker restarts and provider calls.
