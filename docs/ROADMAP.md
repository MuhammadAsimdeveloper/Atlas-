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


## V145 — Real Redis acceleration and worker wakeup

- Native RESP2 Redis client with redis:// and rediss:// support.
- Worker BRPOP wakeup path that only accelerates the PostgreSQL claim loop.
- Redis failure automatically degrades to bounded PostgreSQL polling.
- PostgreSQL remains authoritative; Redis envelopes are wakeup hints, not execution state.
