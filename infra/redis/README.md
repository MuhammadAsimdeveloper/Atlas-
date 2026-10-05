# Atlas Redis runtime

V145 makes Redis a real acceleration and wakeup transport while PostgreSQL remains the durable authority.

## Contract

- Redis endpoint is supplied by deployment configuration.
- Redis lists use atlas:q:<job-type>:p<priority> keys.
- LPUSH publishes bounded wakeup envelopes.
- BRPOP blocks a worker until work is published or the bounded timeout expires.
- The worker does not treat a Redis envelope as authoritative execution state. It only wakes the PostgreSQL claim loop.
- If Redis is unavailable, the worker continues through the PostgreSQL polling path.
- Production still requires managed Redis HA, TLS where applicable, authentication, network policy, eviction protection and measured failover evidence.

Redis is therefore an acceleration plane, never the system of record.
