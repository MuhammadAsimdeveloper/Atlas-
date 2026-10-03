# V100 — Voice Quality Reviews and Coaching

V100 adds a tenant-scoped review and improvement loop for Atlas voice agents. It reviews completed calls against a fixed service-business rubric, summarizes release outcomes and creates bounded coaching codes. Reviews contain structured references and scores; they do not store customer call content.

## Review contract

`createVoiceCallQualityReview()` accepts an intact, completed call from the exact tenant, a fresh evaluator/reviewer attestation bound to the call checksum and review reference, and one score for each rubric criterion:

| Criterion | Weight | Critical | Use |
| --- | ---: | --- | --- |
| Policy and privacy | 25 | Yes | Consent, suppression, scope and allowed-action outcome |
| AI disclosure | 15 | Yes | Required disclosure before AI connects |
| Booking or intake completion | 20 | No | Appointment, lead qualification or service intake result |
| Grounded answer | 15 | No | Whether answers used approved, current business knowledge |
| Human handoff | 10 | No | Whether uncertainty and specialist/person transfer were handled cleanly |
| Approved follow-up | 15 | No | Whether a suitable, consent-checked follow-up task was recorded |

Each criterion requires an integer score from 0 to 100, confidence in basis points and one to five opaque evidence references. The QA service also binds a small business-intent label (appointment booking, lead qualification, billing, support or other) to a structured evidence reference; appointment conversion uses only calls labeled as appointment-booking intent. The module discards unrecognized request fields and persists no arbitrary note, transcript, recording, customer message, prompt, credential or raw model output. The caller is responsible for constructing evaluator evidence from a trusted QA service or authenticated tenant reviewer after applying the tenant's call retention and consent rules.

Scores below 85 create a bounded coaching code. Scores below 80 on either critical criterion create a safety escalation. Codes point teams to work such as checking a privacy control, repairing disclosure, refreshing approved knowledge, improving a booking/intake step or reviewing a follow-up recipe; they are not generated commands and cannot run automations or change an agent release.

## Release-level metrics and limits

`summarizeVoiceCallQuality()` filters checksummed completed sessions and reviews by tenant, exact session checksum and release membership. It chooses the newest valid review for each call and rejects tampered, cross-tenant, wrong-session and wrong-release rows. It reports:

- quality average and good-review rate;
- task-completion and appointment-conversion rates;
- human-handoff rate and p50/p90 connected duration;
- per-criterion scores, coaching volume and critical-failure counts;
- a release readiness assessment with explicit reasons.

The advisory assessment requires at least 20 calls, an average of 85, task-completion score of at least 80 and zero policy/disclosure critical failures. It only qualifies a release for governance review. Existing agent deployment authorization still applies its own tenant-authority, minimum sample, higher score and error-rate gates; a voice QA result cannot publish, expand canary traffic, grant a tool, connect a channel or bypass human approval.

The aggregate is calculated from trusted tenant-scoped storage on request. Do not put it in a global cache without tenant and release keys. Test calls should be labeled and excluded from live-call metrics by the adapter. Any future opt-in transcript or recording review needs a separate consent, retention, access and deletion design; V100 does not provide content storage or transcript review.

## Persistence and service boundary

`infra/postgres/FINAL-MIGRATION-V100.sql` adds tenant-composite review and criterion rows, forced RLS, append-only triggers, score and criterion constraints, completed-session enforcement and indexes for review queues and release analytics. Set `app.tenant_id` only after server authentication and tenant membership lookup. A service should write the review and its six criterion rows in one transaction and enforce idempotency with `(tenant_id, session_id, review_ref)`.

The pure module is a contract, not a complete hosted review service. Production still needs authenticated API endpoints, reviewer role resolution, an asynchronous QA evaluator, durable retries, atomic persistence, provider call logs, agent dashboards and delivery of scheduled reports. No phone, transcript, recording, sentiment or email provider is connected here.

## Desktop preview

The command center shows illustrative quality metrics, rubric categories and two coaching examples. It is explicitly labeled as sample data. It does not query calls or send reports. The laptop is the primary operator surface; phone layouts collapse metrics into a two-column companion view.
