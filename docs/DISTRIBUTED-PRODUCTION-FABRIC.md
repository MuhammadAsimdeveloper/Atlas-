# Atlas V139–V143 Distributed Production Fabric

## Authority boundary
PostgreSQL remains the durable execution authority. Redis is an acceleration/wakeup transport only. A Redis outage must never delete or invalidate durable work. Workers can always fall back to PostgreSQL polling/recovery.

## V139
- Redis transport abstraction with priority queues.
- 64 KiB dispatch envelope limit and deterministic envelope hash.
- PostgreSQL fallback when Redis is unavailable.
- Recovery claims durable jobs and reconstructs dispatch envelopes.
- Distributed wakeups are hints; durable leases remain authoritative.

## V140
Autoscaling consumes queue depth, active workers, utilization and SLO error-budget signals. Bounds and cooldowns prevent oscillation. Scaling must never bypass runtime-pool capacity or SLO protections.

## V141
Worker leases and idempotency remain the duplicate-execution boundary. Recovery distinguishes worker crash, Redis outage and database outage. Database outage fails closed for claiming; Redis outage degrades to PostgreSQL.

## V142
The repository provides bounded OTLP span construction and durable destination contracts. Production must supply a real OTLP collector, alert routing and dashboards.

## V143
Deployment evidence covers managed PostgreSQL, Redis HA, KMS/secrets, WAF/CDN, backups/PITR, restore drills, load tests, disaster recovery, provider credentials and public origin. These are gates, not claims.

## Required production verification
1. Managed PostgreSQL with TLS verification, backups and PITR.
2. Redis HA with authentication/TLS and tested failover.
3. Secret/KMS provider with rotation.
4. WAF/CDN and real HTTPS public origin.
5. Real provider credentials configured through the secret resolver.
6. Load test at target concurrency.
7. Worker crash and Redis/DB failure drills.
8. Backup restore drill with measured RPO/RTO.
9. OTLP collector and alert routing.
10. Only after evidence is current should the deployment gate report ready.


## V144–V150 operational integration

### V144
Durable dispatch state and bounded runtime control events provide the operational decision ledger. Optional OTLP HTTP export is best-effort and never blocks customer execution.

### V145
A native bounded Redis RESP2 client provides `LPUSH` dispatch and blocking `BRPOP` wakeups. Redis is a wake/acceleration path only; durable job state remains in PostgreSQL.

### V146
The autoscaler uses a per-pool scaler lease so only one worker may actuate at a time. Decisions are persisted before actuation, bounded by policy and recorded as actuated/failed/advisory evidence.

### V147
Open SLO alerts fan out to enabled destinations through durable per-alert/per-destination delivery records. HTTPS webhooks use an Atlas HMAC signature and retries are bounded.

### V148
Provider actions use a durable tenant/action idempotency identity. Ambiguous delivery outcomes enter reconciliation and cannot be blindly retried.

### V149
Recovery drills execute bounded deterministic simulations for worker, Redis, PostgreSQL, duplicate-execution and split-brain scenarios. Live infrastructure drills remain deployment adapters.

### V150
Production evidence is a separate machine-verifiable control set. Repository code cannot mark live infrastructure as verified; only time-bounded deployment evidence can satisfy the final gate.
