# Atlas V85 Release Checklist

## V82 Reliability
- [x] Health state machine
- [x] Latency/error-rate assessment
- [x] Credential health signal
- [x] Capability drift detection
- [x] Bounded exponential backoff
- [x] Health/capability persistence schema

## V83 Evaluation/Observability
- [x] Golden-case evaluation
- [x] Tenant-safe trace validation
- [x] Evaluation score
- [x] Release gate
- [x] OpenTelemetry-compatible instrumentation facade
- [x] Observability contract

## V84 Durable Operations
- [x] Approval-gated state machine
- [x] Idempotency primitive
- [x] Retry attempt tracking
- [x] Compensation states
- [x] Action/event persistence schema

## V85 Command Center
- [x] Laptop-first dashboard
- [x] Pipeline KPI
- [x] Connector reliability
- [x] Agent evaluation
- [x] Operational risks
- [x] Action inbox interaction
- [x] Responsive companion layout

## Production hardening still required
- [ ] Real provider adapters wired to health contract
- [ ] Queue-backed durable worker implementation
- [ ] Postgres repository implementation and row-level tenant policies
- [ ] OTLP exporter configuration per environment
- [ ] Browser E2E and accessibility automation
- [ ] Secrets/credential rotation workflow
- [ ] SLOs and alert routing per production tenant tier