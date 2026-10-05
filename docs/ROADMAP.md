# Atlas Runtime Roadmap

V139–V143 establish the distributed production fabric.

- V139: Redis acceleration with PostgreSQL durability fallback.
- V140: bounded SLO-aware autoscaling controls.
- V141: worker/transport/database failover and recovery-drill evidence.
- V142: OTLP/metrics/traces and alert destination contracts.
- V143: deployment evidence for managed infrastructure, security edge, backup/restore, load and disaster recovery.

Repository readiness is not the same as live infrastructure. External controls must be evidenced before a production deployment is declared ready.


## V144 — Runtime control-plane integration

- Durable dispatch state and bounded control-event ledger.
- Optional best-effort OTLP HTTP export.
- Runtime execution now records auditable worker outcomes without making telemetry authoritative.
