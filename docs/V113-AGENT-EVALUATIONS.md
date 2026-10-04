# Atlas V113 — Agent Evaluation and Release Evidence

V113 adds a server-side regression runner for customer-facing AI agents and closes a release-gate trust gap found during the HighLevel/n8n comparison. Publishing and traffic promotion now require a verifier supplied by the trusted service layer; a caller cannot qualify a release by posting invented score fields.

## Scenario suite

`createAgentEvaluationSuite()` accepts a tenant- and agent-bound set of synthetic or de-identified customer scenarios. Every suite must cover prompt injection, sensitive-data requests, human handoff and out-of-scope intent. Cases tagged with one of those required safety classes must be marked safety-critical. Cases may also specify expected answer/handoff status, a handoff reason, permitted read tools, forbidden tools and approved knowledge-reference IDs.

`runAgentEvaluationSuite()` invokes a trusted evaluator adapter with a test case, candidate fingerprint and explicit `mode: evaluation` / `sideEffectsAllowed: false` flags. The adapter must use the same knowledge, policy and model configuration as the candidate release, but execute against test-only or read-only tools. It must never use production contacts, send messages, book appointments, charge/refund, modify records or call a live customer channel.

The adapter result is checked using own data properties only. Accessors, unscoped citation IDs, undeclared tools, non-read tools, attempted side effects, execution errors, timeouts and cost overruns are recorded as bounded issue codes. Model answers, prompts, provider exception text, knowledge content and tool arguments are not retained in the signed report.

The report binds tenant, agent, suite checksum, evaluator version and an exact candidate fingerprint. It records scenario IDs/tags, pass/fail codes, sample count, pass rate, runtime error rate, p95 latency, estimated cost and critical-failure count. A signing key of at least 32 bytes is required and must remain in the server secret manager/KMS. Never expose it to browser code or tenant users.

## Publish and promote gates

- Initial canary publish: at least 20 recent cases, score at least 95, error rate at most 2%, zero critical failures, and signed evidence for the exact draft configuration.
- Traffic promotion: at least 50 recent cases, score at least 95, error rate at most 2%, zero critical failures, and signed evidence for the exact prior release checksum plus requested target percentage.
- The deployer must provide `createAgentEvaluationVerifier({ signingKey })` or an equivalent trusted verifier. Missing verifiers fail closed with `evaluation_evidence_untrusted`.
- The only global Atlas authority remains the verified Khan platform-owner account. A tenant owner/admin may publish only within a tenant where trusted membership authorizes the action. Evaluation evidence does not grant authority.

The expected candidate identifiers are available as `agentDeploymentFingerprint()` and `agentPromotionFingerprint()`. Evaluation results cannot be reused after the draft, published release or promotion target changes.

## Integration boundary

This is a tested domain service, not a connected AI product. Atlas has not yet added an authenticated Agent Studio screen, evaluation dataset persistence, model provider, real knowledge retrieval, live customer chat, chat session browser, worker queue or reporting API. A deployment service must load cases and credentials from trusted tenant storage, run the candidate with dry-run adapters, sign the report in server-side key storage, persist it immutably and inject the verifier into publish/promote calls.

The evaluation runner deliberately does not claim that a model judged itself correctly. It checks the output against explicit, deterministic scenario expectations and records test coverage. More advanced semantic scoring should be separately calibrated against human-reviewed examples and must never replace server-side tool authorization, tenant isolation, consent, approval or provider-side idempotency.

## Checks

The V113 tests cover required scenario coverage, signature integrity, key and tenant isolation, exact candidate binding, retries/timeouts, output redaction, hostile object shapes, unauthorized tools, write attempts, cost overruns, caller-supplied metric rejection and existing Khan-only global authority behavior. Provider model quality, real integrations, database persistence, public chatbot UX and production key management remain external work.
