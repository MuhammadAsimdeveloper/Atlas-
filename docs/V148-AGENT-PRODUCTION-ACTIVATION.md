# V148 AI agent production activation contract

The V148 agent runtime is intentionally fail-closed. Setting one flag does not make the service live.

Required reviewed modules when live execution is enabled:
- ATLAS_AGENT_TURN_EXECUTION_ENABLED=true
- ATLAS_AGENT_INPUT_RESOLVER_MODULE=...
- ATLAS_MODEL_ADAPTER_MODULE=...
- ATLAS_AGENT_RESPONSE_SINK_MODULE=...
- ATLAS_WORKER_SECRET_RESOLVER_MODULE=...
- ATLAS_MODEL_BASE_URL=https://...
- ATLAS_MODEL_BASE_URL_ALLOWLIST=https://...
- ATLAS_MODEL_NAME=... or a release-pinned model
- a tenant-scoped release modelPolicy.credentialRef
- ATLAS_AGENT_TURN_EXECUTION_HANDLER_READY=true only after the reviewed provider/input/sink modules report readiness.

The reference modules shipped in V148 are:
- apps/worker/agent-input/inbox.mjs
- apps/worker/model-adapters/openai-compatible.mjs
- apps/worker/response-sinks/inbox.mjs

Those modules are connection boundaries, not proof of live accounts, credentials, domains, provider webhooks, or external KMS. Production activation must additionally prove the managed secret store, HTTPS origin, inbound/outbound provider verification, SLO paging, load/restore and disaster-recovery evidence.

Security invariants:
- durable agent records store hashes/references, never raw prompts or model output
- provider credentials are resolved by reference through the reviewed worker secret resolver
- model destinations must be HTTPS and explicitly allowlisted
- tool execution is tenant/release/capability scoped and high-risk tools pause for approval
- agent-turn state updates require the live worker lease plus optimistic version
- agent-generated inbox responses use execution-scoped idempotency
