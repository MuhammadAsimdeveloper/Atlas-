# Atlas V93 deep audit

Audit scope: source present in `atlas-v90-work`, customer-agent and workflow contracts, PostgreSQL migration targets, authority boundary, command-center preview and October 2026 competitor documentation. The repository has no `.git` directory, database service, provider credentials or production deployment, so those environments could not be inspected.

## Findings addressed in V93

| Priority | Finding | Change | Verification |
| --- | --- | --- | --- |
| High | A published message step carried only a template ID/version. The release did not prove that the tenant-owned template existed or that its channel and purpose matched the step. | Added immutable checksummed template versions, exact dependency validation and release-time revalidation before outbound intent planning. | Cross-tenant, missing, channel/purpose mismatch and tamper tests pass. |
| Medium | The workflow catalog could send messages and create tasks but could not perform basic lead-intake record changes used by service businesses. | Added tenant-bound contact-field updates and tag add/remove commands with deterministic idempotency keys and durable PostgreSQL invocation metadata. | Correct action generation, type mismatch, cross-tenant resume and PII-like literal rejection tests pass. |
| Medium | Release packaging/status notes described V91 despite the current V92 code baseline. | Bumped package metadata, README, changelog, competitor review, audit notes and preview label to V93. | Doctor checks lock/package metadata and release notes; documentation check validates Markdown formatting. |
| Low | There was no single local check for core release/security invariants. | Added `scripts/doctor.mjs` for Node/package consistency, single-owner checks, encrypted-memory schema, tenant RLS, minimal business-action persistence and explicit scale limitations. | The script reports every named check and returns nonzero on failure. |

## Reviewed controls

- Platform-global rights require the internally created authority object plus the verified configured owner email. Tenant admin publication calls use tenant role checks.
- Customer-agent tool calls intersect deployment, actor, agent and skill allowlists; write tools require exact-scope approval. Agent memory needs fresh, tenant/agent/contact/conversation-specific personalization consent.
- Model, knowledge, memory, approval and tool adapters have bounded deadlines. Unknown write outcomes route to a person instead of automatic retry.
- Messaging intents carry tenant/contact/channel/purpose identity and recheck fresh policy, consent, suppression, frequency, send window, approval and delivery idempotency.
- Workflow branches move forward; child workflow and agent releases must be pinned and tenant-matched; action results need the exact pending action type and idempotency key.
- V92/V93 tenant tables enable and force RLS. V93 stores business-action references and a configuration hash, not the action payload or message content.

## Open production risks and unverified items

- No authenticated API/server middleware is present. Function contracts are not protection unless handlers construct authority and tenant scope from trusted session and database state.
- V92/V93 SQL was reviewed and statically checked but not applied to PostgreSQL. Index plans, migration locks, role grants, RLS behavior, concurrency and rollback were not exercised.
- No persistent worker/queue runtime, Redis connection, schedule service, managed secret manager/KMS, email/SMS/WhatsApp/social/voice/calendar/review/payment provider, webhook signature verifier or tenant consent system is connected.
- Template rendering must context-escape values for the target output format. This repository validates template identity/version and placeholder names, but does not render or deliver templates.
- No load, horizontal scaling, queue fairness, provider throttling, backup/restore or failover drill ran. “Millions of users” remains a target, not a demonstrated capacity.
- npm is not installed in the available runtime; `npm audit` could not run. The lockfile currently declares zero runtime package dependencies.
- No Git checkout/remote, Figma connector or provider sandbox was available for branch diff, push, design edits or integration tests.
