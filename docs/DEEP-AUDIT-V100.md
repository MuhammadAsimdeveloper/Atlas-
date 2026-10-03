# V100 Deep Audit — Voice QA, Quality and Coaching

## Scope

V100 closes a concrete gap after V99 made calls routable: teams need to know whether a booking/intake journey worked, whether AI disclosure and privacy controls held, where callers were handed to a person and which specific agent behavior needs a safe revision. The build adds structured review and coaching contracts, immutable Postgres storage and a sample-only laptop-first panel.

## Findings addressed

| Audit gap | V100 change |
| --- | --- |
| A call could be reported as `appointment_booked` without booking evidence | V99 completion now requires an appointment reference and a unique booking event before that outcome |
| A call marked `needs_review` was not classified as terminal | V99 terminal state set now includes `needs_review` |
| Outbound policy snapshots accepted weak/unbounded decision, consent, suppression, quota, terms, capacity or approval refs | V99 now rejects references containing customer-like PII and requires evidence when the policy marks approval required |
| No structured post-call coaching path existed | V100 fixed six-criterion rubric creates bounded, deterministic coaching codes and urgent critical control escalation |
| No release-level voice outcome view existed | V100 summarizes call outcomes, booking/intake completion, human handoff, duration and criterion scores per tenant/release |
| Raw transcript/recording access would broaden privacy exposure | V100 stores numeric results and opaque evidence refs only; UI labels preview numbers as illustrative |
| Model evaluation could be mistaken for runtime authority | Readiness only returns an advisory; publication, tools and routing remain subject to current Atlas owner/tenant authority and release gates |

## Security and privacy review

- Evaluation evidence is fresh, authenticated, same-tenant, exact-session, session-checksum and review-reference bound.
- Review requests validate the entire fixed rubric, unique criterion IDs, bounded integers and opaque evidence references. The stored review schema rejects unknown fields; transcript/customer-content values are not schema fields.
- Reviews require a valid checksummed completed call and retain the agent release chain used by that call.
- Release summaries verify session and review checksums, tenant, call state, session checksum and release membership; duplicate reviews are reduced to the newest valid review per call.
- Scores under 80 on policy/privacy or disclosure create a safety escalation. The advisory readiness result cannot publish a release or grant capabilities.
- V100 SQL uses composite tenant keys, forced row-level security, a trigger that accepts only completed call sessions, immutable row triggers, and public update/delete/truncate revocations.
- V99 now validates booking evidence before recording an appointment outcome, rejects repeat booking overwrites, enforces opaque references across outbound policy snapshots, and stops further transitions from calls marked for review.

## Competitive review and product choice

HighLevel's 2026 Voice AI dashboard and call-log materials describe inbound/outbound analytics, action activity, duration, sentiment, agent filters, per-call execution logs, recordings/transcripts, and scheduled performance summary email. Its September 2026 documentation separates during-call actions from post-call workflows. Atlas adopts the helpful operating concepts—rubric-based review, outcomes, duration, action/handoff signals, targeted coaching and review/production separation—while keeping this release's persistence content-minimal. It intentionally does not reproduce HighLevel's interface or copy its transcript/recording retention model.

Primary references: [HighLevel dashboard and call analytics](https://help.gohighlevel.com/support/solutions/articles/155000004693), [call logs and quality review](https://help.gohighlevel.com/support/solutions/articles/155000007687-voice-ai-agent-logs-and-call-details), [separate during-call/post-call actions](https://help.gohighlevel.com/support/solutions/articles/155000005267-separate-during-and-post-call-actions-in-voice-ai), [performance reports](https://help.gohighlevel.com/support/solutions/articles/155000007984-voice-ai-performance-reports), [n8n evaluation nodes](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.evaluation) and [execution retry/history](https://docs.n8n.io/workflows/executions/all-executions/). Sources were checked 3 October 2026.

n8n's evaluation-node and execution-replay patterns reinforce the value of saved evidence, repeatable test cases and explicit original/current-version retry behavior. Atlas already has a broader evaluation and observability substrate; V100 specializes its output for appointment-led service businesses. Evaluation scores inform controlled rollout and coaching, but never replace deterministic authorization.

## Verification limits

The release's automated tests exercise the pure lifecycle, evaluator evidence, fixed rubric, PII rejection, checksum/tamper rejection, tenant/release aggregation and failure coaching. The SQL is statically checked but has not been applied to PostgreSQL. There is no connected telephony/calendar/message provider, live call service, scheduled reporting job, sentiment model or reviewer API. No capacity, failover, data restore, retention-deletion or millions-of-users test was possible here. Keep those gaps visible in the V100 manifest.
